import axios from 'axios';
import { getIdToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Axios instance with auto auth header ──────────────────────────────────────
const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use(async (config) => {
  try {
    const token = await getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  } catch {
    // Not logged in — let the request go through (server will 401)
  }
  return config;
});

// ── Chats (formerly Conversations) ─────────────────────────────────────────────
export const getChats = () => api.get('/chats/');

export const createChat = (title = 'New Chat') =>
  api.post('/chats/', { title });

export const getChatMessages = (chatId) =>
  api.get(`/chats/${chatId}/messages`);

export const deleteChat = (chatId) =>
  api.delete(`/chats/${chatId}`);

// ── Streaming Chat (SSE via fetch) ────────────────────────────────────────────
export const streamChat = async (
  chatId,
  message,
  onToken,
  onDone,
  onError,
  skipUserSave = false,
  onAudioReady = null
) => {
  let token = '';
  try {
    token = await getIdToken();
  } catch {
    onError('Not authenticated');
    return;
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}/chat/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ 
        chat_id: chatId, 
        message, 
        skip_user_save: skipUserSave 
      }),
    });
  } catch {
    onError('Network error — is the backend running?');
    return;
  }

  if (!response.ok) {
    onError(`Server error: ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError('No response body');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.token) onToken(data.token);
        if (data.done) {
          if (data.audio_generating) {
            onDone(data.message_id ?? '', null, data.audio_generating);
          } else {
            onDone(data.message_id ?? '', data.audio_url ?? '', false);
          }
        }
        if (data.audio_ready && onAudioReady) {
          onAudioReady(data.message_id, data.audio_url);
        }
      } catch {
        // Malformed SSE line — skip
      }
    }
  }
};

// ── Audio ─────────────────────────────────────────────────────────────────────
export const transcribeAudio = (audioBlob, chatId) => {
  const form = new FormData();
  let ext = 'webm';
  if (audioBlob.type.includes('mp4')) ext = 'm4a';
  else if (audioBlob.type.includes('ogg')) ext = 'ogg';
  else if (audioBlob.type.includes('wav')) ext = 'wav';
  else if (audioBlob.type.includes('mpeg')) ext = 'mp3';
  
  form.append('audio', audioBlob, `audio.${ext}`);
  form.append('conversation_id', chatId);
  return api.post('/audio/transcribe', form);
};

export const generateTTS = (text) =>
  api.post('/audio/tts', { text });

// ── Calls ─────────────────────────────────────────────────────────────────────
export const getCalls = () => api.get('/calls/');

export const createCall = (title = 'Voice Call') =>
  api.post('/calls/', { title });

export const deleteCall = (callId) => api.delete(`/calls/${callId}`);

export const getCallMessages = (callId) => api.get(`/calls/${callId}/messages`);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const syncUser = (userData) =>
  api.post('/auth/sync', userData);

export default api;