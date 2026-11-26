import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { DEFAULT_CONFIG, EMPTY_STATUS, MSG, STORAGE_KEYS, UI_ACTION } from './constants';
import { send } from './messages';
import { getConfig, getStatus, setConfig } from './storage';
import type { AssistConfig, RuntimeStatus } from './types';

export function useAssist() {
  const status = ref<RuntimeStatus>({ ...EMPTY_STATUS });
  const config = ref<AssistConfig>({ ...DEFAULT_CONFIG });
  const ready = ref(false);

  const refresh = async () => {
    const [s, c] = await Promise.all([getStatus(), getConfig()]);
    status.value = { ...EMPTY_STATUS, ...s };
    config.value = { ...DEFAULT_CONFIG, ...c };
    ready.value = true;
  };

  const listener = (changes: any, area: string) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.status]?.newValue) status.value = { ...EMPTY_STATUS, ...changes[STORAGE_KEYS.status].newValue };
    if (changes[STORAGE_KEYS.config]?.newValue) config.value = { ...DEFAULT_CONFIG, ...changes[STORAGE_KEYS.config].newValue };
  };

  onMounted(() => {
    refresh();
    chrome.storage?.onChanged?.addListener(listener);
  });
  onUnmounted(() => chrome.storage?.onChanged?.removeListener(listener));

  /** 写配置 + 通知后台广播到当前标注页 */
  const patchConfig = async (patch: Partial<AssistConfig>) => {
    config.value = await setConfig(patch);
    await send({ type: MSG.CONFIG_SET, payload: patch });
  };

  const action = (act: string, value?: unknown) =>
    send({ type: MSG.UI_ACTION, payload: { action: act, value } });

  const openOptions = () => chrome.runtime.openOptionsPage?.();

  return { status, config, ready, refresh, patchConfig, action, openOptions, UI_ACTION };
}

/** 打字机：仅在文本变化时运行，隐藏/卸载即停止，不产生常驻 rAF */
export function useTypewriter(text: Ref<string>, speed: Ref<number>) {
  const shown = ref('');
  let timer: number | undefined;
  let token = 0;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const run = () => {
    const full = String(text.value || '');
    const mine = ++token;
    if (timer) clearTimeout(timer);
    if (reduced || full.length > 240) { shown.value = full; return; }
    shown.value = '';
    let i = 0;
    const step = () => {
      if (mine !== token) return;
      i += 1;
      shown.value = full.slice(0, i);
      if (i < full.length) timer = window.setTimeout(step, Math.max(8, Number(speed.value) || 24));
    };
    step();
  };

  watch([text, speed], run, { immediate: true });
  onUnmounted(() => { token += 1; if (timer) clearTimeout(timer); });
  return shown;
}
