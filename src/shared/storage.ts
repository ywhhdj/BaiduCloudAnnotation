import { DEFAULT_CONFIG, EMPTY_STATUS, STORAGE_KEYS } from './constants';
import type { ApprovalEntry, AssistConfig, GuardEntry, RuntimeStatus } from './types';

const store = (): any => (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);

async function read<T>(key: string, fallback: T): Promise<T> {
  const s = store();
  if (!s) return fallback;
  const obj = await s.get(key);
  return (obj?.[key] ?? fallback) as T;
}

async function write(key: string, value: unknown): Promise<void> {
  const s = store();
  if (!s) return;
  await s.set({ [key]: value });
}

export async function getConfig(): Promise<AssistConfig> {
  const saved = await read<Partial<AssistConfig>>(STORAGE_KEYS.config, {});
  return { ...DEFAULT_CONFIG, ...saved };
}

export async function setConfig(patch: Partial<AssistConfig>): Promise<AssistConfig> {
  const next = { ...(await getConfig()), ...patch };
  await write(STORAGE_KEYS.config, next);
  return next;
}

export async function getStatus(): Promise<RuntimeStatus> {
  return { ...EMPTY_STATUS, ...(await read<Partial<RuntimeStatus>>(STORAGE_KEYS.status, {})) };
}

export async function setStatus(patch: Partial<RuntimeStatus>): Promise<RuntimeStatus> {
  const next = { ...(await getStatus()), ...patch, updatedAt: Date.now() };
  await write(STORAGE_KEYS.status, next);
  return next;
}

/** 守护表 / 审批表按 任务+页 分片，避免不同题目互相污染 */
export async function guardKeyOf(markId: string, pageId: string): Promise<string> {
  return `${STORAGE_KEYS.guards}:${markId || 'unknown'}:${pageId || '0'}`;
}

export async function approvalKeyOf(markId: string, pageId: string): Promise<string> {
  return `${STORAGE_KEYS.approvals}:${markId || 'unknown'}:${pageId || '0'}`;
}

export async function getGuards(markId: string, pageId: string): Promise<GuardEntry[]> {
  return await read<GuardEntry[]>(await guardKeyOf(markId, pageId), []);
}

export async function putGuard(markId: string, pageId: string, entry: GuardEntry): Promise<GuardEntry[]> {
  const key = await guardKeyOf(markId, pageId);
  const list = await read<GuardEntry[]>(key, []);
  const idx = list.findIndex((g) => g.boxId === entry.boxId && g.frameId === entry.frameId);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  if (list.length > 600) list.splice(0, list.length - 600);
  await write(key, list);
  return list;
}

export async function putGuards(markId: string, pageId: string, entries: GuardEntry[]): Promise<GuardEntry[]> {
  const key = await guardKeyOf(markId, pageId);
  const list = await read<GuardEntry[]>(key, []);
  const map = new Map(list.map((g) => [`${g.boxId}|${g.frameId ?? ''}`, g]));
  for (const e of entries) map.set(`${e.boxId}|${e.frameId ?? ''}`, e);
  const merged = Array.from(map.values()).slice(-600);
  await write(key, merged);
  return merged;
}

export async function clearGuards(markId: string, pageId: string): Promise<void> {
  await write(await guardKeyOf(markId, pageId), []);
}

// ---------------------------------------------------------------- 审批表

export async function getApprovals(markId: string, pageId: string): Promise<ApprovalEntry[]> {
  return await read<ApprovalEntry[]>(await approvalKeyOf(markId, pageId), []);
}

export async function putApprovals(markId: string, pageId: string, entries: ApprovalEntry[]): Promise<ApprovalEntry[]> {
  const key = await approvalKeyOf(markId, pageId);
  const list = await read<ApprovalEntry[]>(key, []);
  const map = new Map(list.map((a) => [a.boxId, a]));
  for (const e of entries) map.set(e.boxId, e);
  const merged = Array.from(map.values()).slice(-900);
  await write(key, merged);
  return merged;
}

export async function clearApprovals(markId: string, pageId: string): Promise<void> {
  await write(await approvalKeyOf(markId, pageId), []);
}

// ---------------------------------------------------------------- 答案框模板

/** 记录平台「一个真实框节点」长什么样，自动出框时按它克隆，避免结构不被平台识别 */
export async function getBoxTemplate(markId: string, pageId: string): Promise<any | null> {
  return await read<any | null>(`${STORAGE_KEYS.boxTemplate}:${markId || 'unknown'}:${pageId || '0'}`, null);
}

export async function setBoxTemplate(markId: string, pageId: string, node: any): Promise<void> {
  if (!node || typeof node !== 'object') return;
  await write(`${STORAGE_KEYS.boxTemplate}:${markId || 'unknown'}:${pageId || '0'}`, JSON.parse(JSON.stringify(node)));
}

// ---------------------------------------------------------------- 自动检测去重

export async function wasAutoDetected(markId: string, pageId: string): Promise<boolean> {
  const done = await read<Record<string, number>>(STORAGE_KEYS.autoDetectDone, {});
  const v = done[`${markId}:${pageId}`];
  // 12 小时内不重复自动出框；换题 / 换页 / 手动重跑不受限
  return Boolean(v && Date.now() - v < 12 * 3600 * 1000);
}

export async function markAutoDetected(markId: string, pageId: string): Promise<void> {
  const done = await read<Record<string, number>>(STORAGE_KEYS.autoDetectDone, {});
  done[`${markId}:${pageId}`] = Date.now();
  await write(STORAGE_KEYS.autoDetectDone, done);
}

export async function clearAutoDetected(markId: string, pageId: string): Promise<void> {
  const done = await read<Record<string, number>>(STORAGE_KEYS.autoDetectDone, {});
  delete done[`${markId}:${pageId}`];
  await write(STORAGE_KEYS.autoDetectDone, done);
}
