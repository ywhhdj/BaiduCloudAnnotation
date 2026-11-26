import { DOM_SELECTORS, TASK_INPUT_IDS, UNIQUE_FORMAT } from '../../shared/constants';
import { parseTaskKey } from '../../shared/urlRules';
import type { AssistConfig, Box3D, FrameMeta, FrameSourceId, PlatformTypeHint, TaskInfo } from '../../shared/types';
import { parseAnswer } from './answerAdapter';

const htmlDecode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");

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

export interface SchemaInfo {
  toolConfig: Record<string, any>;
  platformTypes: PlatformTypeHint[];
}

/** 读 topic-schema：只取配置与类别表，绝不写回题目数据 */
export function readSchema(doc: Document, question: any): SchemaInfo {
  let schema: any = null;
  const node = doc.querySelector(DOM_SELECTORS.topicSchema);
  if (node?.textContent) {
    try { schema = JSON.parse(htmlDecode(node.textContent.trim())); } catch { /* fallthrough */ }
  }
  if (!schema) {
    const raw = JSON.stringify(question || {});
    const at = raw.indexOf('"toolConfig"');
    if (at >= 0) {
      const brace = raw.indexOf('{', at);
      const frag = balancedObject(raw, brace);
      if (frag) { try { schema = { toolConfig: JSON.parse(frag) }; } catch { /* ignore */ } }
    }
  }
  const toolConfig = schema?.toolConfig && typeof schema.toolConfig === 'object' ? schema.toolConfig : {};
  const platformTypes: PlatformTypeHint[] = [];
  if (Array.isArray(schema?.typeConfig)) {
    for (const t of schema.typeConfig) {
      const typeId = String(t?.typeId || '');
      if (!typeId) continue;
      platformTypes.push({ typeId, name: String(t?.type?.name || typeId) });
    }
  }
  return { toolConfig, platformTypes };
}

export interface UniqueSegments {
  parts: string[][];
  zip: string[][];
  lidar: string[][];
  camera: string[][];
  calib: string[][];
  ids: string[][];
  meta: string[][];
  lengths: number[];
}

/** 按内容识别 unique 段类型（实测：part0=zip，1=lidar，2..8=camera，9=calib，10=frameId；顺序可变也兼容） */
export function classifyUnique(doc: Document, question: any): UniqueSegments {
  const raw = typeof question?.unique === 'string' ? question.unique : '';
  const parts: string[][] = raw
    ? raw.split(UNIQUE_FORMAT.segmentSeparator).slice(0, UNIQUE_FORMAT.maxSegmentScan).map((p) => p.split(UNIQUE_FORMAT.itemSeparator))
    : [];
  const out: UniqueSegments = { parts, zip: [], lidar: [], camera: [], calib: [], ids: [], meta: [], lengths: [] };
  for (const seg of parts) {
    if (!seg.length) continue;
    const first = (seg[0] || '').trim();
    const low = first.toLowerCase();
    if (low.includes(UNIQUE_FORMAT.zipHint) && /^https?:|^\/\//.test(first)) out.zip.push(seg);
    else if (low.includes(UNIQUE_FORMAT.lidarHint)) out.lidar.push(seg);
    else if (low.includes(UNIQUE_FORMAT.cameraHint)) out.camera.push(seg);
    else if (first.startsWith(UNIQUE_FORMAT.calibHint)) out.calib.push(seg);
    else if (first && !/^https?:|^\/\//.test(first) && first.length <= 96 && seg.every((v) => !/\s/.test(v || ''))) out.ids.push(seg);
    else out.meta.push(seg);
    out.lengths.push(seg.length);
  }
  return out;
}

function urlDom(doc: Document): string[] {
  const el = doc.querySelector(DOM_SELECTORS.frameUrlDom);
  const text = el?.textContent?.trim() || '';
  return text ? text.split(UNIQUE_FORMAT.itemSeparator).map((u) => htmlDecode(u.trim())).filter(Boolean) : [];
}

export interface FrameHints {
  platformFrameCount?: number;
  platformFrameIndex?: number;
}

interface FrameSourceArgs {
  seg: UniqueSegments;
  domUrls: string[];
  toolConfig: Record<string, any>;
  doc: Document;
  hints: FrameHints
}

function sourceValue(
  id: FrameSourceId,
  args: FrameSourceArgs,
): number {
  const { seg, domUrls, toolConfig, doc, hints } = args;
  switch (id) {
    case 'unique': {
      const lens = seg.lengths.filter((n) => n > 0);
      return lens.length ? Math.max(...lens) : 0;
    }
    case 'urlDom':
      return domUrls.length;
    case 'framePagination': {
      const n = doc.querySelectorAll(DOM_SELECTORS.frameItem).length;
      return n > 0 ? n : 0;
    }
    case 'toolConfig': {
      const base = Number(toolConfig.frameCount) || 0;
      const repeat = Number(toolConfig.repeatFrameCount) || 0;
      return base > 0 ? base + (repeat > 0 ? repeat : 0) : 0;
    }
    case 'finalFrameCount':
      return Number(hidden(doc, TASK_INPUT_IDS.finalFrameCount)) || 0;
    case 'answerGroups': {
      const text = hidden(doc, 'mark_answer_json') || hidden(doc, 'user_answer_temp_json');
      if (!text) return 0;
      try {
        const parsed = parseAnswer(text);
        const ids = new Set(parsed.boxes.map((b) => String(b.frameId || '')).filter(Boolean));
        return ids.size;
      } catch {
        return 0;
      }
    }
    case 'platformKernel':
      return Number(hints.platformFrameCount) || 0;
    default: return 0;
  }
}

/** 帧数自动获取：多来源交叉校验；strict 模式没有真实帧就返回 0，绝不补 5 帧/假帧 */
export function resolveFrameCount(
  cfg: AssistConfig,
  args: FrameSourceArgs,
): {
  frameCount: number;
  source: string
} {
  const values: Array<{ id: FrameSourceId; n: number }> = [];
  for (const id of cfg.frameSources) {
    const n = sourceValue(id, args);
    if (Number.isFinite(n) && n > 0) values.push({ id, n });
  }
  if (!values.length)
    return {
      frameCount: 0,
      source: '无有效来源（不补帧）'
    };
  let chosen = values[0];
  if (cfg.frameCountFallbackPolicy === 'max')
    chosen = values.reduce((a, b) => (b.n > a.n ? b : a), values[0]);
  else if (cfg.frameCountFallbackPolicy === 'declared') chosen = values.find((v) => v.id === 'toolConfig') || chosen;
  const agree = values.filter((v) => v.n === chosen.n).map((v) => v.id);
  return {
    frameCount: chosen.n,
    source: `${chosen.id}(${chosen.n})${agree.length > 1 ? ` · 交叉校验 ${agree.join('/')}` : ''}`
  };
}

function frameIdOf(seg: UniqueSegments, zipUrl: string, index: number): string {
  const ids = seg.ids[0]?.[index];
  if (ids) return ids;
  if (zipUrl) {
    const name = zipUrl.split('?')[0].split('/').pop() || '';
    if (name) return name.replace(/\.(zip|bin|pcd)$/i, '');
  }
  return String(index);
}

/** 读任务：URL 键、帧数、帧地址、类别表全部动态获得 */
export function readTask(doc: Document, loc: Location, cfg: AssistConfig, hints: FrameHints = {}): TaskInfo {
  const key = parseTaskKey(loc.href);
  const markId = hidden(doc, TASK_INPUT_IDS.markId) || key.markId || '';
  const pageId = hidden(doc, TASK_INPUT_IDS.pageId) || key.pageId || '1';
  let question: any = {};
  try {
    question = JSON.parse(hidden(doc, TASK_INPUT_IDS.question) || '{}');
  } catch { /* ignore */ }

  const { toolConfig, platformTypes } = readSchema(doc, question);
  const seg = classifyUnique(doc, question);
  const domUrls = urlDom(doc);
  const { frameCount, source } = resolveFrameCount(cfg, {
    seg,
    domUrls,
    toolConfig,
    doc,
    hints
  });

  const zipSeg = seg.zip[0] || [];
  const lidarSeg = seg.lidar[0] || [];
  const calibSeg = seg.calib[0] || [];
  const frames: FrameMeta[] = [];
  for (let i = 0; i < frameCount; i++) {
    const zipUrl = zipSeg[i] || domUrls[i] || lidarSeg[i] || '';
    const cameraUrls = seg.camera.map((c) => c[i]).filter(Boolean) as string[];
    let calib: any;
    const calibRaw = calibSeg[i];
    if (calibRaw) {
      try {
        calib = JSON.parse(htmlDecode(calibRaw));
      }
      catch {
        try {
          calib = JSON.parse(calibRaw);
        } catch { /* ignore */ }
      }
    }
    frames.push({
      frameId: frameIdOf(seg, zipUrl, i),
      index: i,
      zipUrl: htmlDecode(zipUrl),
      zipSource: zipSeg[i] ? 'unique.zip' : domUrls[i] ? '#url' : lidarSeg[i] ? 'unique.lidar' : '',
      lidarUrl: lidarSeg[i] ? htmlDecode(lidarSeg[i]) : undefined,
      cameraUrls,
      calib,
      skipped: !zipUrl,
    });
  }
  const skippedFrames = frames.filter((f) => f.skipped).length;
  return {
    markId,
    pageId,
    frameCount,
    frameCountSource: source,
    frameUrlsSource: zipSeg.length ? 'unique.zip' : domUrls.length ? '#url' : lidarSeg.length ? 'unique.lidar' : '无',
    skippedFrames,
    frames,
    toolConfig,
    platformTypes,
    topic: question?.questions?.['1']?.topic || 'pointCloudMark',
  };
}

/**
 * 当前帧只认平台帧列表 active 项 / 平台内核帧号。
 * page_id 是题目页码，绝不是帧索引
 */
export function detectFrameIndex(doc: Document, task: TaskInfo, platformFrameIndex?: number): number {
  if (Number.isFinite(platformFrameIndex) && (platformFrameIndex as number) >= 0) {
    return Math.min(platformFrameIndex as number, Math.max(0, task.frames.length - 1));
  }
  const items = Array.from(doc.querySelectorAll(DOM_SELECTORS.frameItem));
  if (items.length) {
    const idx = items.findIndex((el) =>
      el.className?.includes?.('FramePagination_active') || el.querySelector(DOM_SELECTORS.frameActive));
    if (idx >= 0) return Math.min(idx, Math.max(0, task.frames.length - 1));
  }
  return 0;
}

/** 按 frameId 把答案里的框映射到真实帧；无 frameId 的一律归当前帧 */
export function groupBoxesByFrame(boxes: Box3D[], task: TaskInfo, currentIndex: number): Map<number, Box3D[]> {
  const indexOf = new Map<string, number>();
  task.frames.forEach((f, i) => {
    indexOf.set(String(f.frameId), i);
    if (f.aicvId) indexOf.set(String(f.aicvId), i);
  });
  const groups = new Map<number, Box3D[]>();
  const fallbackId = task.frames[currentIndex]?.frameId || String(currentIndex);
  for (const box of boxes) {
    let idx = box.frameId ? indexOf.get(String(box.frameId)) : undefined;
    if (idx === undefined) {
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

/** 只返回可下载点云的地址；相机图片 URL 一律拒绝（旧版段错位会把相机图当点云） */
export function zipUrlOf(task: TaskInfo, index: number): string {
  const u = task.frames[index]?.zipUrl || '';
  if (!u) return '';
  if (/framecamera|\.(jpg|jpeg|png|webp)$/i.test(u)) return '';
  if (u.startsWith('//')) return `${location.protocol}${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  return new URL(u, location.origin).toString();
}

export {
  mapPlatformTypeId
} from '../../shared/classify';
