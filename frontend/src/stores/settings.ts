import { defineStore } from 'pinia';
import { ref } from 'vue';

function readBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

/** 界面偏好（本地小量状态，不入 IndexedDB） */
export const useSettings = defineStore('settings', () => {
  const isDark = ref(readBool('eo_dark', window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
  function toggleDark() {
    isDark.value = !isDark.value;
    try {
      localStorage.setItem('eo_dark', isDark.value ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
  return { isDark, toggleDark };
});
