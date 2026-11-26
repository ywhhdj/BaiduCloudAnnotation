declare const chrome: any;

interface Window {
  __PC_ASSIST_HOOK__?: boolean;
  __PC_ASSIST_API__?: {
    version: string;
    applyAnswer: (text: string, source?: string) => boolean;
    readAnswer: () => string;
    patchToolConfig: (patch: Record<string, unknown>) => boolean;
    reload: () => void;
  };
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
