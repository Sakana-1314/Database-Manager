import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiLogin } from '../api/client';

const TOKEN_KEY = 'eo_token';
const EXP_KEY = 'eo_token_exp';

function readToken(): { token: string; expiresAt: number } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const exp = Number(localStorage.getItem(EXP_KEY) ?? 0);
    if (!token || !exp) return null;
    return { token, expiresAt: exp };
  } catch {
    return null;
  }
}

export const useAuth = defineStore('auth', () => {
  const saved = readToken();
  const token = ref<string | null>(saved?.token ?? null);
  const expiresAt = ref<number>(saved?.expiresAt ?? 0);
  const loading = ref(false);

  const isAuthed = computed(() => !!token.value && expiresAt.value > Date.now() + 5000);

  function persist() {
    try {
      if (token.value) {
        localStorage.setItem(TOKEN_KEY, token.value);
        localStorage.setItem(EXP_KEY, String(expiresAt.value));
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EXP_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  async function login(username: string, password: string): Promise<void> {
    loading.value = true;
    try {
      const data = await apiLogin(username, password);
      token.value = data.token;
      expiresAt.value = data.expiresAt;
      persist();
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    token.value = null;
    expiresAt.value = 0;
    persist();
  }

  function logout() {
    clear();
  }

  return { token, expiresAt, loading, isAuthed, login, clear, logout };
});
