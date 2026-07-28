/**
 * Audio service — MediaRecorder wrapper for voice recording,
 * speech-activated silence-detection, and Web Audio API audio player for playback & RMS visualizer.
 */

// ── Silence Detector ──────────────────────────────────────────────────────────

/**
 * SilenceDetector listens on an existing MediaStream (from VoiceRecorder.stream)
 * and fires onSilence() after `pauseDurationMs` of continuous silence ONLY AFTER
 * user speech activity has been detected.
 */
export class SilenceDetector {
  _audioCtx = null;
  _analyser = null;
  _source = null;
  _pollId = null;
  _rms = 0;
  _silenceStart = null;
  _active = false;
  _paused = false;
  hasSpoken = false; // Set to true once speech threshold is crossed

  /** Silence threshold — RMS below this is considered silence */
  static SILENCE_THRESHOLD = 0.015;
  /** Speech activity threshold — RMS must cross this at least once before silence counts */
  static SPEECH_THRESHOLD = 0.022;
  /** How often to poll the analyser (ms) */
  static POLL_MS = 80;

  start(stream, pauseMs, onSilence) {
    this.stop();
    this._active = true;
    this._paused = false;
    this.hasSpoken = false;
    this._silenceStart = null;

    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = 256;
    this._source = this._audioCtx.createMediaStreamSource(stream);
    this._source.connect(this._analyser);

    const buf = new Float32Array(this._analyser.fftSize);

    const poll = () => {
      if (!this._active) return;
      if (!this._paused) {
        this._analyser.getFloatTimeDomainData(buf);

        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
        this._rms = Math.sqrt(sumSq / buf.length);

        // Check if user has started speaking
        if (this._rms >= SilenceDetector.SPEECH_THRESHOLD) {
          this.hasSpoken = true;
        }

        const now = Date.now();
        // Only trigger silence auto-send if speech has occurred first
        if (this.hasSpoken && this._rms < SilenceDetector.SILENCE_THRESHOLD) {
          if (this._silenceStart === null) this._silenceStart = now;
          if (now - this._silenceStart >= pauseMs) {
            this.stop();
            onSilence();
            return;
          }
        } else {
          this._silenceStart = null;
        }
      } else {
        this._rms = 0;
      }

      this._pollId = setTimeout(poll, SilenceDetector.POLL_MS);
    };

    this._pollId = setTimeout(poll, SilenceDetector.POLL_MS);
  }

  pause() {
    this._paused = true;
    this._silenceStart = null;
    this._rms = 0;
  }

  resume() {
    this._paused = false;
    this._silenceStart = null;
  }

  stop() {
    this._active = false;
    this._paused = false;
    if (this._pollId) { clearTimeout(this._pollId); this._pollId = null; }
    try { this._source?.disconnect(); } catch { }
    try { this._audioCtx?.close(); } catch { }
    this._audioCtx = null;
    this._analyser = null;
    this._source = null;
    this._silenceStart = null;
    this._rms = 0;
    this.hasSpoken = false;
  }

  /** Current RMS level 0–1 (for visualizer bars) */
  getRMS() {
    if (this._paused) return 0;
    return this._rms;
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────

export class VoiceRecorder {
  mediaRecorder = null;
  chunks = [];
  stream = null;

  static isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices !== 'undefined' &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined'
    );
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      },
    });
    this.chunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    this.mediaRecorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined
    );

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(100);
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

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Recorder not started'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: this.mediaRecorder.mimeType || 'audio/webm',
        });
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop());
        }
        resolve(blob);
      };

      this.mediaRecorder.onerror = (e) => reject(e);
      this.mediaRecorder.stop();
    });
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

  get isPaused() {
    return this.mediaRecorder?.state === 'paused';
  }
}

// ── Playback with Analyser ───────────────────────────────────────────────────

export class AudioPlayer {
  audio = null;
  audioCtx = null;
  analyser = null;
  source = null;
  objectUrl = null;
  _rms = 0;
  _pollId = null;

  playChunk(bytes, onEnded, onError) {
    this.stop();

    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    this.objectUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.objectUrl);
    this.audio.crossOrigin = 'anonymous';

    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.source = this.audioCtx.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      const buf = new Float32Array(this.analyser.fftSize);
      // Store poll reference and always continue until explicitly stopped
      const poll = () => {
        if (!this.analyser || !this.audio || this.audio.paused) {
          this._rms = 0;
        } else {
          this.analyser.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          this._rms = Math.sqrt(sumSq / buf.length);
        }
        // Always schedule next poll — only _cleanUp() sets _pollId to null to stop
        this._pollId = setTimeout(poll, 80);
      };
      this._pollId = setTimeout(poll, 80);
    } catch {
      // Fallback if Web Audio API fails — audio still plays, just no RMS
    }

    this.audio.onended = () => {
      this._cleanUp();
      onEnded?.();
    };

    this.audio.onerror = (e) => {
      this._cleanUp();
      onError?.(e);
    };

    // Resume AudioContext (required after user-gesture to satisfy autoplay policy)
    const doPlay = async () => {
      try {
        if (this.audioCtx?.state === 'suspended') {
          await this.audioCtx.resume();
        }
        await this.audio.play();
      } catch (e) {
        this._cleanUp();
        onError?.(e);
      }
    };

    doPlay();
  }

  pause() {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  resume() {
    if (this.audio && this.audio.paused) {
      this.audioCtx?.resume();
      this.audio.play().catch(() => { });
    }
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this._cleanUp();
  }

  _cleanUp() {
    if (this._pollId) { clearTimeout(this._pollId); this._pollId = null; }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    try { this.source?.disconnect(); } catch { }
    try { this.audioCtx?.close(); } catch { }
    this.audio = null;
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this._rms = 0;
  }

  getRMS() {
    if (!this.audio || this.audio.paused) return 0;
    return this._rms;
  }
}

/** Fallback helper if simple playback is needed */
export const playChunkBytes = (bytes) => {
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.play().catch(() => { });
  return audio;
};
