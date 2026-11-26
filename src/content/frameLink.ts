import { DOM_SELECTORS, TASK_INPUT_IDS } from '../shared/constants';
import type { Box3D, FrameMeta, TaskInfo } from '../shared/types';

const htmlDecode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function hidden(doc: Document, id: string): string {
  return (doc.getElementById(id) as HTMLInputElement | null)?.value?.trim() || '';
}

function balancedObject(text: string, startAt: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = startAt; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(startAt, i + 1);
  }
  return null;
}

function readToolConfig(doc: Document, question: any): Record<string, any> {
  const node = doc.querySelector(DOM_SELECTORS.topicSchema);
  if (node?.textContent) {
    try {
      const obj = JSON.parse(htmlDecode(node.textContent.trim()));
      if (obj?.toolConfig) return obj.toolConfig;
    } catch { /* fallthrough */ }
  }
  const raw = JSON.stringify(question || {});
  const at = raw.indexOf('"toolConfig"');
  if (at >= 0) {
    const brace = raw.indexOf('{', at);
    const frag = balancedObject(raw, brace);
    if (frag) { try { return JSON.parse(frag); } catch { /* ignore */ } }
  }
  return { frameCount: 5, autoFitBox: false, multiFrameMarkMode: false };
}

/** 从 #question_json.unique 的 7 段 @_@ / #!# 结构还原 5 帧（页面快照确认的格式） */
export function readTask(doc: Document, loc: Location): TaskInfo {
  const markId = hidden(doc, TASK_INPUT_IDS.markId) || (loc.pathname.match(/\/id\/(\d+)/) || [])[1] || '';
  const pageId = hidden(doc, TASK_INPUT_IDS.pageId) || (loc.pathname.match(/\/page_id\/(\d+)/) || [])[1] || '1';
  let question: any = {};
  try { question = JSON.parse(hidden(doc, 'question_json') || '{}'); } catch { /* ignore */ }

  const toolConfig = readToolConfig(doc, question);
  const frames: FrameMeta[] = [];
  const unique = typeof question.unique === 'string' ? question.unique : '';
  const parts = unique.split('#!#').map((p) => p.split('@_@'));
  const count = parts.length >= 6 ? parts[2].length : 0;

  for (let i = 0; i < count; i++) {
    let calib: any;
    const calibRaw = parts[6]?.[i];
    if (calibRaw) {
      try { calib = JSON.parse(htmlDecode(calibRaw)); }
      catch { try { calib = JSON.parse(calibRaw); } catch { /* ignore */ } }
    }
    frames.push({
      frameId: parts[2]?.[i] || `${i}`,
      index: i,
      zipUrl: parts[5]?.[i] || '',
      timestamp: Number(parts[3]?.[i]) || undefined,
      record: parts[1]?.[i],
      aicvId: parts[4]?.[i],
      calib,
    });
  }
  const declared = Number(toolConfig.frameCount) || Number(hidden(doc, TASK_INPUT_IDS.finalFrameCount)) || 0;
  const frameCount = Math.max(frames.length, declared || 5);
  while (frames.length < frameCount) {
    frames.push({ frameId: `fallback-${frames.length}`, index: frames.length });
  }

  return {
    markId,
    pageId,
    frameCount,
    frames,
    toolConfig,
    topic: question?.questions?.['1']?.topic || 'pointCloudMark',
  };
}

/** 帧列表 active 项 / URL page_id 都可能是当前帧，取最可信的一个 */
export function detectFrameIndex(doc: Document, loc: Location, task: TaskInfo): number {
  const items = Array.from(doc.querySelectorAll(DOM_SELECTORS.frameItem));
  if (items.length) {
    const idx = items.findIndex((el) => el.className?.includes?.('FramePagination_active') || el.querySelector(DOM_SELECTORS.frameActive));
    if (idx >= 0) return Math.min(idx, task.frames.length - 1);
  }
  const fromUrl = Number((loc.pathname.match(/\/page_id\/(\d+)/) || [])[1]);
  if (Number.isFinite(fromUrl) && fromUrl > 0) return Math.min(fromUrl - 1, task.frames.length - 1);
  return 0;
}

/** 按 frameId 把答案里的框映射到帧；无 frameId 的一律归当前帧 */
export function groupBoxesByFrame(boxes: Box3D[], task: TaskInfo, currentIndex: number): Map<number, Box3D[]> {
  const indexOf = new Map<string, number>();
  task.frames.forEach((f, i) => {
    indexOf.set(String(f.frameId), i);
    if (f.timestamp) indexOf.set(String(f.timestamp), i);
    if (f.aicvId) indexOf.set(String(f.aicvId), i);
  });
  const groups = new Map<number, Box3D[]>();
  const fallbackId = task.frames[currentIndex]?.frameId || String(currentIndex);
  for (const box of boxes) {
    let idx = box.frameId ? indexOf.get(String(box.frameId)) : undefined;
    if (idx === undefined) {
      // 部分模板把帧号放在 box.id / trackId 里
      const m = String(box.frameId || box.id).match(/(\d{1,3})$/);
      if (m && Number(m[1]) < task.frames.length) idx = Number(m[1]);
    }
    if (idx === undefined) idx = currentIndex;
    if (!box.frameId) box.frameId = String(task.frames[idx]?.frameId ?? fallbackId);
    if (!groups.has(idx)) groups.set(idx, []);
    groups.get(idx)!.push(box);
  }
  return groups;
}

export function zipUrlOf(task: TaskInfo, index: number): string {
  const u = task.frames[index]?.zipUrl || '';
  if (!u) return '';
  if (u.startsWith('//')) return `${location.protocol}${u}`;
  if (u.startsWith('http')) return u;
  return new URL(u, location.origin).toString();
}
