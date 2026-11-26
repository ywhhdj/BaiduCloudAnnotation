import type { AssistConfig } from './types'

type Patch = (patch: Partial<AssistConfig>) => unknown

export function useConfigBinder(patchConfig: Patch, getConfig: () => AssistConfig) {
  const bool = (key: keyof AssistConfig) => (v: boolean) =>
    patchConfig({
      [key]: v
    } as any)

  const num = (key: keyof AssistConfig) => (v: number) =>
    patchConfig({
      [key]: v
    } as any)

  const nested =
    <G extends keyof AssistConfig>(group: G, key: string) =>
      (v: unknown) =>
        patchConfig({
          [group]: {
            ...((getConfig() as any)[group] ?? {}),
            [key]: v
          }
        } as any)

  const nestedNum =
    <G extends keyof AssistConfig>(group: G, key: string) =>
      (v: number) =>
        nested(group, key)(v)

  const nestedBool =
    <G extends keyof AssistConfig>(group: G, key: string) =>
      (v: boolean) =>
        nested(group, key)(v)

  return {
    bool,
    num,
    nested,
    nestedNum,
    nestedBool
  }
}