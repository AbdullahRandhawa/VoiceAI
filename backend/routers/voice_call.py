"""
Real-Time Voice Call — WebSocket endpoint.

Flow:
  1. Client sends FULL recorded audio blob (binary frame)
  2. Server transcribes via STT                → sends {type:"transcript"}
  3. Server streams LLM tokens                 → sends {type:"token"} per token
  4. As LLM streams, sentences are buffered.
     Each complete sentence → TTS → binary audio frame back to client
  5. Client plays audio chunks in order as they arrive
  6. Server saves the exchange to calls/{call_id}/messages
  7. When the call ends, server concatenates all user & AI speech segment files,
     uploads the combined audio to Cloudinary, and saves the URL in the call document.
"""
import re
import os
import subprocess
import tempfile
import shutil
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from firebase_admin import auth as firebase_auth
from services import openrouter, firestore as firestore_service, cloudinary_service
from config import settings

router = APIRouter()

# Sentence boundary detector
_SENTENCE_END = re.compile(r"([^.!?]+[.!?]+)")


def _split_sentences(text: str) -> tuple[list[str], str]:
    sentences = _SENTENCE_END.findall(text)
    matched_length = sum(len(s) for s in sentences)
    leftover = text[matched_length:]
    return sentences, leftover


def concatenate_audio_segments(segment_paths: list[str], output_path: str) -> bool:
    """Concatenate WebM (user) and MP3 (AI) segments into a single MP3 via ffmpeg."""
    if not segment_paths:
        return False
    
    # Single file conversion/copy
    if len(segment_paths) == 1:
        cmd = [
            "ffmpeg", "-y",
            "-i", segment_paths[0],
            "-ac", "2",
            "-ar", "44100",
            output_path
        ]
    else:
        cmd = ["ffmpeg", "-y"]
        for path in segment_paths:
            cmd.extend(["-i", path])
        
        # Complex filter: join all inputs' audio streams
        inputs_str = "".join(f"[{i}:a]" for i in range(len(segment_paths)))
        filter_str = f"{inputs_str}concat=n={len(segment_paths)}:v=0:a=1[outa]"
        
        cmd.extend([
            "-filter_complex", filter_str,
            "-map", "[outa]",
            "-ac", "2",
            "-ar", "44100",
            output_path
        ])
    
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=90)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="ignore")
            print(f"[Audio Concat] ffmpeg failed (code {result.returncode}): {stderr[-300:]}")
        return result.returncode == 0
    except Exception as e:
        print(f"[Audio Concat] Exception during merge: {e}")
        return False


@router.websocket("/voice-call")
async def voice_call_ws(
    websocket: WebSocket,
    token: str = Query(..., description="Firebase ID token"),
    call_id: str = Query(None, description="Call document ID for persistence"),
):
    try:
        firebase_auth.verify_id_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()

    # Session exchanges history in-memory for LLM context
    session_history: list[dict] = []

    # Audio recording tracking for merging later
    audio_segments: list[str] = []
    temp_dir = tempfile.mkdtemp()

    # Load existing exchanges if call_id is provided (resuming a call)
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
            # ── 1. Receive full audio blob (user speech) ─────────────────
            audio_bytes = await websocket.receive_bytes()

            # Save user segment file
            user_seg_path = os.path.join(temp_dir, f"segment_{len(audio_segments)}_user.webm")
            try:
                with open(user_seg_path, "wb") as f:
                    f.write(audio_bytes)
                audio_segments.append(user_seg_path)
            except Exception as e:
                print(f"[Voice Call] Error saving user segment file: {e}")

            # ── 2. STT ───────────────────────────────────────────────────
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

            # Auto-title call from first exchange
            if call_id and len(session_history) == 0:
                try:
                    short_title = transcript[:60] + ("…" if len(transcript) > 60 else "")
                    await firestore_service.update_call(call_id, title=short_title)
                except Exception as e:
                    print(f"[Voice Call] Error auto-titling call: {e}")

            # ── 3+4. Stream LLM → sentence-level TTS ────────────────────
            buffer = ""
            full_response: list[str] = []

            try:
                messages_for_llm = list(session_history)
                messages_for_llm.append({"role": "user", "content": transcript})

                async for token in openrouter.chat_stream(messages_for_llm):
                    full_response.append(token)
                    buffer += token

                    # Emit token for live text display
                    await websocket.send_json({"type": "token", "text": token})

                    # Check for complete sentences → TTS
                    sentences, buffer = _split_sentences(buffer)
                    for sentence in sentences:
                        sentence = sentence.strip()
                        if not sentence:
                            continue
                        try:
                            audio_chunk = await openrouter.text_to_speech(sentence)
                            await websocket.send_bytes(audio_chunk)

                            # Save AI segment file
                            ai_seg_path = os.path.join(temp_dir, f"segment_{len(audio_segments)}_ai.mp3")
                            with open(ai_seg_path, "wb") as f:
                                f.write(audio_chunk)
                            audio_segments.append(ai_seg_path)
                        except Exception as e:
                            print(f"[Voice Call] Error generating/saving AI TTS segment: {e}")

                # Flush remaining buffer
                if buffer.strip():
                    try:
                        audio_chunk = await openrouter.text_to_speech(buffer.strip())
                        await websocket.send_bytes(audio_chunk)

                        # Save AI segment file
                        ai_seg_path = os.path.join(temp_dir, f"segment_{len(audio_segments)}_ai.mp3")
                        with open(ai_seg_path, "wb") as f:
                            f.write(audio_chunk)
                        audio_segments.append(ai_seg_path)
                    except Exception as e:
                        print(f"[Voice Call] Error saving final AI TTS segment: {e}")

                complete_response = "".join(full_response)

                # Update session history
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
                        print(f"[Voice Call] Error persisting call exchange: {e}")

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
        # Merge all audio segments into a single file and upload to Cloudinary
        if audio_segments:
            print(f"[Voice Call] Merging {len(audio_segments)} audio segments…")
            merged_path = os.path.join(temp_dir, "merged_call.mp3")
            success = concatenate_audio_segments(audio_segments, merged_path)
            if success:
                try:
                    with open(merged_path, "rb") as f:
                        merged_bytes = f.read()
                    print(f"[Voice Call] Uploading merged audio ({len(merged_bytes)}B) to Cloudinary…")
                    upload_res = await cloudinary_service.upload_audio(merged_bytes, filename="merged_call.mp3")
                    if call_id:
                        await firestore_service.update_call(call_id, audio_url=upload_res["url"])
                        print(f"[Voice Call] Saved call recording to Call doc: {upload_res['url']}")
                except Exception as e:
                    print(f"[Voice Call] Failed to upload merged recording: {e}")
            else:
                print("[Voice Call] Failed to merge audio segments")

        # Clean up temporary directory and files
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
