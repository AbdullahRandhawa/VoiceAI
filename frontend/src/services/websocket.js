/**
 * WebSocket manager for the Real-Time Voice Call feature.
 *
 * Protocol:
 *   Client → binary  : full recorded audio blob
 *   Server → JSON    : {type:"transcript"|"token"|"done"|"error", text?, message?}
 *   Server → binary  : MP3 audio chunk (one per TTS sentence)
 *
 * onAllAudioDone fires after the "done" message AND the entire audio queue
 * has finished playing — so auto-listen never starts mid-speech.
 */
import { getIdToken } from './auth';
import { playChunkBytes } from './audio';

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws');

export class VoiceCallService {
  ws = null;
  audioQueue = [];
  isPlaying = false;
  _donePending = false;      // "done" JSON arrived but audio still queued
  _callbacks = {};

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
    if (conversationId) {
      url += `&call_id=${conversationId}`;
    }
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.audioQueue.push(event.data);
        this._drainQueue();
        return;
      }

      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'transcript':
            callbacks?.onTranscript(data.text ?? '');
            break;
          case 'token':
            callbacks?.onToken(data.text ?? '');
            break;
          case 'done':
            // Mark done; fire onAllAudioDone only after queue drains
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
    if (this.isPlaying || this.audioQueue.length === 0) return;
    this.isPlaying = true;
    const chunk = this.audioQueue.shift();
    const audio = playChunkBytes(chunk);
    audio.onended = () => {
      this.isPlaying = false;
      if (this.audioQueue.length > 0) {
        this._drainQueue();
      } else if (this._donePending) {
        // All audio played AND server sent done → notify
        this._fireDone();
      }
    };
    audio.onerror = () => {
      this.isPlaying = false;
      this._drainQueue();
    };
  }

  sendAudio(blob) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(blob);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
    }
    this.ws = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this._donePending = false;
    this._callbacks = {};
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
