/**
 * WebSocket manager for the Real-Time Voice Call feature.
 *
 * Protocol:
 *   Client → binary  : full recorded audio blob
 *   Server → JSON    : {type:"transcript"|"token"|"done"|"error", text?, message?}
 *   Server → binary  : MP3 audio chunk (one per TTS sentence)
 */
import { getIdToken } from './auth';
import { playChunkBytes } from './audio';

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws');

export class VoiceCallService {
  ws = null;
  audioQueue = [];
  isPlaying = false;

  async connect(conversationId, callbacks) {
    // NOTE: Firebase tokens can be sent as a query param since WS headers
    // aren't supported in browsers. The backend should validate this.
    let token = '';
    try {
      token = await getIdToken();
    } catch {
      callbacks.onError('Not authenticated');
      return;
    }
    let url = `${WS_URL}/ws/voice-call?token=${token}`;
    if (conversationId) {
      url += `&conversation_id=${conversationId}`;
    }
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Queue audio chunks and play sequentially
        this.audioQueue.push(event.data);
        this._drainQueue();
        return;
      }

      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'transcript':
            callbacks.onTranscript(data.text ?? '');
            break;
          case 'token':
            callbacks.onToken(data.text ?? '');
            break;
          case 'done':
            callbacks.onDone();
            break;
          case 'error':
            callbacks.onError(data.message ?? 'Unknown error');
            break;
          default:
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => callbacks.onError('WebSocket connection error');

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('No WebSocket'));
      this.ws.onopen = () => resolve();
      // Only set onerror if not already set, or rely on the instance's onerror
    });
  }

  _drainQueue() {
    if (this.isPlaying || this.audioQueue.length === 0) return;
    this.isPlaying = true;
    const chunk = this.audioQueue.shift();
    const audio = playChunkBytes(chunk);
    audio.onended = () => {
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
    if (this.ws) this.ws.close();
    this.ws = null;
    this.audioQueue = [];
    this.isPlaying = false;
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
