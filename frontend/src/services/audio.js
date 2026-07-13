/**
 * Audio service — MediaRecorder wrapper for voice recording
 * and Web Audio API for playback.
 */

// ── Recording ─────────────────────────────────────────────────────────────────

export class VoiceRecorder {
  mediaRecorder = null;
  chunks = [];
  stream = null; // exposed publicly so UI can hook AnalyserNode

  /** Returns true if the browser supports audio recording */
  static isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices !== 'undefined' &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined'
    );
  }

  async start() {
    // Request high-quality mic input
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      },
    });
    this.chunks = [];

    // Prefer webm/opus; fall back to whatever the browser supports
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';

    console.log('[VoiceRecorder] Using mimeType:', mimeType || '(browser default)');

    this.mediaRecorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined
    );

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(100); // Collect data every 100 ms
    console.log('[VoiceRecorder] Recording started');
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Recorder not started'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        console.log('[VoiceRecorder] Stopped. Blob:', blob.type, blob.size, 'bytes, chunks:', this.chunks.length);
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop());
        }
        resolve(blob);
      };

      this.mediaRecorder.onerror = (e) => {
        console.error('[VoiceRecorder] MediaRecorder error:', e);
        reject(e);
      };
      this.mediaRecorder.stop();
    });
  }

  pause() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  resume() {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  cancel() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.chunks = [];
  }

  get isRecording() {
    return this.mediaRecorder?.state === 'recording';
  }
}

// ── Playback ──────────────────────────────────────────────────────────────────

let activeAudio = null;

export const playAudioUrl = (url) => {
  // Stop any currently playing audio
  stopAudio();
  activeAudio = new Audio(url);
  activeAudio.play();
  return activeAudio;
};

export const playAudioBytes = (bytes) => {
  stopAudio();
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  activeAudio = new Audio(url);
  activeAudio.onended = () => URL.revokeObjectURL(url);
  activeAudio.play();
  return activeAudio;
};

export const playChunkBytes = (bytes) => {
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.play();
  return audio;
};

export const stopAudio = () => {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
};
