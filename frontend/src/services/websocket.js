/**
 * WebSocket manager for the Real-Time Voice Call feature.
 *
 * Protocol:
 *   Client → binary  : full recorded audio blob
 *   Server → JSON    : {type:"transcript"|"token"|"done"|"error"|"title", text?, message?}
 *   Server → binary  : MP3 audio chunk (one per TTS sentence)
 */
import { getIdToken } from './auth';
import { AudioPlayer } from './audio';

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws');

export class VoiceCallService {
  ws = null;
  audioQueue = [];
  isPlaying = false;
  isPaused = false;
  _donePending = false;
  _callbacks = {};
  _audioStartedFired = false;  // Track if onAudioStarted was fired for this exchange
  _playGuardTimeout = null;    // Safety: reset isPlaying if stuck
  player = new AudioPlayer();

  async connect(conversationId, callbacks) {
    this._callbacks = callbacks || {};
    let token = '';
    try {
      token = await getIdToken();
    } catch {
      callbacks?.onError('Not authenticated');
      return;
    }

    let url = `${WS_URL}/ws/voice-call?token=${token}`;
    if (conversationId) url += `&call_id=${conversationId}`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.audioQueue.push(event.data);
        if (!this.isPaused) {
          this._drainQueue();
        }
        return;
      }

      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'transcript':
            // Reset audio-started flag for the new exchange
            this._audioStartedFired = false;
            callbacks?.onTranscript(data.text ?? '');
            break;
          case 'token':
            callbacks?.onToken(data.text ?? '');
            break;
          case 'title':
            callbacks?.onTitle?.(data.text ?? '');
            break;
          case 'created':
            callbacks?.onCreated?.(data.call_id, data.title ?? '');
            break;
          case 'done':
            this._donePending = true;
            if (!this.isPlaying && this.audioQueue.length === 0) {
              this._fireDone();
            }
            break;
          case 'error':
            callbacks?.onError(data.message ?? 'Unknown error');
            break;
          default:
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      if (event.code !== 1000 && event.code !== 1005) {
        if (this._donePending || this.isPlaying) {
          this._donePending = false;
          this.isPlaying = false;
          this.audioQueue = [];
        }
        callbacks?.onError('Connection lost. Please retry.');
      }
    };

    this.ws.onerror = () => callbacks?.onError('WebSocket connection error');

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('No WebSocket'));
      this.ws.onopen = () => resolve();
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  _fireDone() {
    this._donePending = false;
    this._callbacks?.onDone?.();
  }

  _drainQueue() {
    if (this.isPaused || this.isPlaying || this.audioQueue.length === 0) return;

    this.isPlaying = true;

    // Safety net: if isPlaying stays true for >30s something went wrong — reset
    if (this._playGuardTimeout) clearTimeout(this._playGuardTimeout);
    this._playGuardTimeout = setTimeout(() => {
      if (this.isPlaying) {
        console.warn('[VoiceCallService] isPlaying stuck — force resetting');
        this.isPlaying = false;
        this._drainQueue();
      }
    }, 30_000);

    const chunk = this.audioQueue.shift();

    // Fire onAudioStarted once per exchange so page can transition to SPEAKING
    if (!this._audioStartedFired) {
      this._audioStartedFired = true;
      this._callbacks?.onAudioStarted?.();
    }

    this.player.playChunk(
      chunk,
      () => {
        // onEnded
        if (this._playGuardTimeout) { clearTimeout(this._playGuardTimeout); this._playGuardTimeout = null; }
        this.isPlaying = false;
        if (!this.isPaused && this.audioQueue.length > 0) {
          this._drainQueue();
        } else if (this._donePending && this.audioQueue.length === 0) {
          this._fireDone();
        }
      },
      () => {
        // onError
        if (this._playGuardTimeout) { clearTimeout(this._playGuardTimeout); this._playGuardTimeout = null; }
        this.isPlaying = false;
        if (!this.isPaused) {
          this._drainQueue();
        }
      }
    );
  }

  pausePlayback() {
    this.isPaused = true;
    this.player.pause();
  }

  resumePlayback() {
    this.isPaused = false;
    if (this.isPlaying) {
      this.player.resume();
    } else if (this.audioQueue.length > 0) {
      this._drainQueue();
    }
  }

  stopPlayback() {
    this.isPaused = false;
    this.isPlaying = false;
    this.audioQueue = [];
    this._donePending = false;
    if (this._playGuardTimeout) { clearTimeout(this._playGuardTimeout); this._playGuardTimeout = null; }
    this.player.stop();
  }

  getPlaybackRMS() {
    return this.player.getRMS();
  }

  sendAudio(blob) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(blob);
    }
  }

  disconnect() {
    this.stopPlayback();
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close(1000);
    }
    this.ws = null;
    this._callbacks = {};
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
