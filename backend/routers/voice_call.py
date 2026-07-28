"""
Real-Time Voice Call — WebSocket endpoint.

Optimized pipeline (lowest latency):
  1. Receive full audio blob from client
  2. STT  (async ffmpeg + OpenRouter) — non-blocking
  3. LLM  stream tokens → show live text on client
      ↳ TTS Task #0 fires in parallel once sentences 1+2 are buffered
  4. LLM finishes → batch all remaining sentences → TTS Task #1
  5. asyncio.gather(task0, task1) → send audio in order
  6. Persist exchange + upload merged recording to Cloudinary on disconnect
"""
import re
import os
import asyncio
import traceback
import subprocess
import tempfile
import shutil
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from firebase_admin import auth as firebase_auth
from services import openrouter, firestore as firestore_service, cloudinary_service
from config import settings

router = APIRouter()

# ── Voice system prompt ───────────────────────────────────────────────────────
VOICE_SYSTEM_PROMPT = (
    "You are a friendly, helpful voice assistant having a real conversation. "
    "Keep every response SHORT — 1 to 3 sentences maximum, like a real person talking. "
    "Be natural, warm, and direct. Never use markdown, bullet points, numbered lists, "
    "headers, code blocks, or special characters — just plain conversational speech. "
    "If you don't know something, say so briefly. "
    "If you need to explain multiple things, pick the most important one. "
    "Never repeat the user's question back to them."
)

# Sentence boundary — matches text ending with . ! ?
_SENTENCE_END = re.compile(r"([^.!?]+[.!?]+)")


def _split_sentences(text: str) -> tuple[list[str], str]:
    sentences = _SENTENCE_END.findall(text)
    matched_length = sum(len(s) for s in sentences)
    leftover = text[matched_length:]
    return sentences, leftover


def _get_ffmpeg_cmd() -> str | None:
    """Find system ffmpeg or fallback to imageio_ffmpeg binary."""
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def concatenate_audio_segments(segment_paths: list[str], output_path: str) -> bool:
    """Concatenate WebM (user) + MP3 (AI) segments into a single MP3 via ffmpeg."""
    if not segment_paths:
        return False

    ffmpeg_bin = _get_ffmpeg_cmd()
    if not ffmpeg_bin:
        print("[Audio Concat] ffmpeg not found in PATH or imageio_ffmpeg — cannot merge audio segments")
        return False

    if len(segment_paths) == 1:
        cmd = [ffmpeg_bin, "-y", "-i", segment_paths[0], "-ac", "2", "-ar", "44100", output_path]
    else:
        cmd = [ffmpeg_bin, "-y"]
        for path in segment_paths:
            cmd.extend(["-i", path])
        inputs_str = "".join(f"[{i}:a]" for i in range(len(segment_paths)))
        filter_str = f"{inputs_str}concat=n={len(segment_paths)}:v=0:a=1[outa]"
        cmd.extend(["-filter_complex", filter_str, "-map", "[outa]", "-ac", "2", "-ar", "44100", output_path])

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=90)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="ignore")
            print(f"[Audio Concat] ffmpeg failed (code {result.returncode}): {stderr[-400:]}")
        return result.returncode == 0
    except Exception as e:
        print(f"[Audio Concat] Exception: {e}")
        return False


@router.websocket("/voice-call")
async def voice_call_ws(
    websocket: WebSocket,
    token: str = Query(..., description="Firebase ID token"),
    call_id: str = Query(None, description="Call document ID for persistence"),
):
    # ── Auth ─────────────────────────────────────────────────────────────────
    uid = None
    try:
        decoded = firebase_auth.verify_id_token(token)
        uid = decoded.get("uid")
    except Exception:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()

    if call_id in ("new", "", "null", "undefined"):
        call_id = None

    session_history: list[dict] = []
    audio_segments: list[str] = []
    temp_dir = tempfile.mkdtemp()

    # Warn early if ffmpeg is missing — saves confusion at disconnect
    if not _get_ffmpeg_cmd():
        print("[Voice Call] ⚠️  ffmpeg not found — call recording will NOT be saved")

    # Load existing exchanges if resuming
    if call_id:
        try:
            existing = await firestore_service.get_call_messages(call_id)
            for ex in existing:
                session_history.append({"role": "user",      "content": ex["transcript"]})
                session_history.append({"role": "assistant", "content": ex["response"]})
        except Exception:
            pass

    try:
        while True:
            # ── 1. Receive audio blob ─────────────────────────────────────
            audio_bytes = await websocket.receive_bytes()

            # Save user audio segment for final recording
            user_seg_path = os.path.join(temp_dir, f"segment_{len(audio_segments):04d}_user.webm")
            try:
                with open(user_seg_path, "wb") as f:
                    f.write(audio_bytes)
                audio_segments.append(user_seg_path)
            except Exception as e:
                print(f"[Voice Call] Error saving user segment: {e}")

            # ── 2. STT (async — non-blocking) ─────────────────────────────
            try:
                transcript = await openrouter.transcribe_audio(audio_bytes, "audio.webm")
            except Exception as exc:
                await websocket.send_json({"type": "error", "message": f"STT failed: {exc}"})
                continue

            if not transcript.strip():
                await websocket.send_json({"type": "transcript", "text": ""})
                await websocket.send_json({"type": "done"})
                continue

            await websocket.send_json({"type": "transcript", "text": transcript})

            # Auto-create / auto-title call on first exchange
            if len(session_history) == 0:
                try:
                    short_title = transcript[:60] + ("…" if len(transcript) > 60 else "")
                    if not call_id and uid:
                        new_call = await firestore_service.create_call(uid, title=short_title)
                        call_id = new_call["id"]
                        await websocket.send_json({"type": "created", "call_id": call_id, "title": short_title})
                    elif call_id:
                        await firestore_service.update_call(call_id, title=short_title)
                        await websocket.send_json({"type": "title", "text": short_title})
                except Exception as e:
                    print(f"[Voice Call] Error creating/titling call: {e}")

            # ── 3+4+5. Parallel LLM stream + TTS ─────────────────────────
            #
            # Pipeline:
            #   • Stream LLM tokens → send to client live
            #   • Buffer sentences; fire TTS Task#0 (sentences 1+2) the moment
            #     sentence 2 is complete — while LLM keeps generating
            #   • After LLM finishes, batch all remaining sentences → TTS Task#1
            #   • asyncio.gather both tasks → send audio chunks in order
            #
            buffer = ""
            full_response: list[str] = []
            raw_sentences: list[str] = []   # all complete sentences from LLM
            tts_tasks: dict[int, asyncio.Task] = {}  # idx → Task[bytes]

            try:
                messages_for_llm = list(session_history)
                messages_for_llm.append({"role": "user", "content": transcript})

                async for token in openrouter.chat_stream(
                    messages_for_llm,
                    system_prompt=VOICE_SYSTEM_PROMPT,
                ):
                    full_response.append(token)
                    buffer += token
                    await websocket.send_json({"type": "token", "text": token})

                    new_sents, buffer = _split_sentences(buffer)
                    for s in new_sents:
                        s = s.strip()
                        if s:
                            raw_sentences.append(s)

                    # 🔥 Fire TTS#0 in parallel once we have first 2 sentences
                    if len(raw_sentences) >= 2 and 0 not in tts_tasks:
                        txt0 = " ".join(raw_sentences[:2])
                        print(f"[TTS#0] Firing ({len(txt0)} chars) while LLM continues…")
                        tts_tasks[0] = asyncio.create_task(openrouter.text_to_speech(txt0))

                # LLM done — flush any remaining text
                if buffer.strip():
                    raw_sentences.append(buffer.strip())

                # Determine TTS grouping
                if tts_tasks:
                    # TTS#0 already has sentences 1+2 — batch everything else into TTS#1
                    remaining = raw_sentences[2:]
                    if remaining:
                        txt1 = " ".join(remaining)
                        print(f"[TTS#1] Firing remaining ({len(txt1)} chars)")
                        tts_tasks[1] = asyncio.create_task(openrouter.text_to_speech(txt1))
                else:
                    # Fewer than 2 sentences total — TTS everything at once
                    if raw_sentences:
                        txt0 = " ".join(raw_sentences)
                        print(f"[TTS#0] Firing single batch ({len(txt0)} chars)")
                        tts_tasks[0] = asyncio.create_task(openrouter.text_to_speech(txt0))

                # Wait for all TTS tasks to complete then send in order
                for idx in sorted(tts_tasks):
                    try:
                        audio_chunk = await tts_tasks[idx]
                        await websocket.send_bytes(audio_chunk)

                        # Save AI audio segment for recording
                        ai_seg_path = os.path.join(
                            temp_dir, f"segment_{len(audio_segments):04d}_ai.mp3"
                        )
                        with open(ai_seg_path, "wb") as f:
                            f.write(audio_chunk)
                        audio_segments.append(ai_seg_path)
                    except Exception as e:
                        print(f"[Voice Call] TTS#{idx} error: {e}")

                complete_response = "".join(full_response)

                # Update in-memory history
                session_history.append({"role": "user",      "content": transcript})
                session_history.append({"role": "assistant", "content": complete_response})

                # Persist exchange to Firestore
                if call_id:
                    try:
                        await firestore_service.save_call_message(
                            call_id,
                            transcript=transcript,
                            response=complete_response,
                        )
                    except Exception as e:
                        print(f"[Voice Call] Error persisting exchange: {e}")

            except Exception as exc:
                await websocket.send_json({"type": "error", "message": f"LLM error: {exc}"})
                continue

            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Voice Call] WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
    finally:
        # ── Merge all audio segments and upload to Cloudinary ─────────────
        try:
            if audio_segments and call_id:
                print(f"[Voice Call] Merging {len(audio_segments)} audio segments…")
                merged_path = os.path.join(temp_dir, "merged_call.mp3")
                success = concatenate_audio_segments(audio_segments, merged_path)
                if success and os.path.exists(merged_path):
                    with open(merged_path, "rb") as f:
                        merged_bytes = f.read()
                    print(f"[Voice Call] Uploading merged audio ({len(merged_bytes)}B) to Cloudinary…")
                    upload_res = await cloudinary_service.upload_audio(
                        merged_bytes, filename="merged_call.mp3"
                    )
                    await firestore_service.update_call(call_id, audio_url=upload_res["url"])
                    print(f"[Voice Call] ✅ Recording saved: {upload_res['url']}")
                else:
                    print("[Voice Call] ❌ Audio merge failed — recording not uploaded")
            elif not call_id:
                print("[Voice Call] No call_id — skipping recording upload (empty session)")
            elif not audio_segments:
                print("[Voice Call] No audio segments captured — nothing to upload")
        except Exception:
            print(f"[Voice Call] ❌ Error in recording upload:\n{traceback.format_exc()}")

        # Clean up temp files
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
