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

// ── Conversations ─────────────────────────────────────────────────────────────
export const getConversations = () => api.get('/conversations/');

export const createConversation = (title = 'New Chat') =>
  api.post('/conversations/', { title });

export const getMessages = (conversationId) =>
  api.get(`/conversations/${conversationId}/messages`);

export const deleteConversation = (conversationId) =>
  api.delete(`/conversations/${conversationId}`);

// ── Streaming Chat (SSE via fetch) ────────────────────────────────────────────
export const streamChat = async (
  conversationId,
  message,
  onToken,
  onDone,
  onError
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
      body: JSON.stringify({ conversation_id: conversationId, message }),
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
        if (data.done) onDone(data.message_id ?? '');
      } catch {
        // Malformed SSE line — skip
      }
    }
  }
};

// ── Audio ─────────────────────────────────────────────────────────────────────
export const transcribeAudio = (audioBlob, conversationId) => {
  const form = new FormData();
  form.append('audio', audioBlob, 'audio.webm');
  form.append('conversation_id', conversationId);
  return api.post('/audio/transcribe', form);
};

export const generateTTS = (text) =>
  api.post('/audio/tts', { text });

export default api;
