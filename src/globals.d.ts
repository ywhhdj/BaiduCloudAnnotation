declare const chrome: any;

export {}

interface Window {
  __PC_ASSIST_HOOK__?: boolean;
  __PC_ASSIST_API__?: {
    version: string;
    applyAnswer: (text: string, source?: string) => boolean;
    readAnswer: () => string;
    patchToolConfig: (patch: Record<string, unknown>) => boolean;
    probePlatform: () => Record<string, unknown>;
    nativeFit: (boxIds?: string[]) => boolean;
    callPlatform: (method: string, args?: unknown[]) => unknown;
    getPlatformState: () => Record<string, unknown>;
    reload: () => void;
  };
  /** 平台可能暴露的内核对象（名称由 AssistConfig.platformApi.globals 配置探测） */
  [key: string]: any;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
