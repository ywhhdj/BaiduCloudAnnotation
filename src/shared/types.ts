export type Vec3 = [number, number, number];

/** 统一后的 3D 框。raw 指向平台答案 JSON 里的原始节点，回写时只改几何字段。 */
export interface Box3D {
  id: string;
  frameId?: string;
  trackId?: string;
  typeId?: string;
  center: Vec3;
  size: Vec3;
  yaw: number;
  source?: string;
  attrs?: Record<string, unknown>;
  raw?: any;
  path?: (string | number)[];
}

export interface FrameMeta {
  frameId: string;
  index: number;
  zipUrl?: string;
  zipSource?: string;
  lidarUrl?: string;
  cameraUrls?: string[];
  timestamp?: number;
  record?: string;
  aicvId?: string;
  calib?: any;
  skipped?: boolean;
}

export type FrameSourceId = 'unique' | 'urlDom' | 'framePagination' | 'toolConfig' | 'finalFrameCount' | 'answerGroups' | 'platformKernel';

export interface PlatformTypeHint {
  typeId: string;
  name: string;
}

export interface TaskInfo {
  markId: string;
  pageId: string;
  /** 真实帧数：由 frameSources 动态得出，绝不固定、不补假帧 */
  frameCount: number;
  frameCountSource?: string;
  urlRule?: string;
  frameUrlsSource?: string;
  skippedFrames?: number;
  frames: FrameMeta[];
  toolConfig: Record<string, any>;
  platformTypes?: PlatformTypeHint[];
  topic?: string;
}

/** 兼容旧结构的尺寸先验（由 ClassProfile 派生） */
export interface ClassPrior {
  typeId: string;
  name: string;
  size: Vec3;
  tolerance: number;
}

/**
 * 类别尺寸先验 —— 新增一种物体只需在设置页加一行。
 * platformTypeId 对齐平台 topic-schema.typeConfig[].typeId；留空时按 aliases 自动映射。
 */
export interface ClassProfile {
  id: string;
  name: string;
  platformTypeId?: string;
  aliases: string[];
  /** 长 / 宽 / 高（米） */
  size: Vec3;
  /** 尺寸相对容差，越大越容易命中 */
  tolerance: number;
  sizeRange?: { l: [number, number]; w: [number, number]; h: [number, number] };
  aspectRatio?: [number, number];
  minPoints?: number;
  minConfidence?: number;
  weight?: number;
  enabled: boolean;
}

/** 自动框选出的候选框：状态是「待人工审批」，不是最终答案 */
export interface CandidateBox {
  id: string;
  frameId?: string;
  trackId?: string;
  typeId?: string;
  center: Vec3;
  size: Vec3;
  yaw: number;
  confidence: number;
  pointCount: number;
  reason: string;
}

export type ApprovalState = 'pending' | 'approved' | 'rejected';

export interface ApprovalEntry {
  boxId: string;
  frameId?: string;
  trackId?: string;
  state: ApprovalState;
  confidence: number;
  suggestedType?: string;
  signature: string;
  path?: (string | number)[];
  at: number;
  reason?: string;
}

export interface UrlRule {
  id: string;
  /** 通配符规则：* 匹配任意字符（含 /），覆盖 .../id/*\/page_id/* 及尾缀 */
  pattern: string;
  enabled: boolean;
  description?: string;
}

export interface ToolConfigField {
  key: string;
  value: boolean | number | string;
  enabled: boolean;
}

export interface PlatformApiMap {
  globals: string[];
  kernelPaths: string[];
  fitMethodNames: string[];
  createMethodNames: string[];
  frameCountPaths: string[];
  framesPaths: string[];
  fitButtonSelectors: string[];
}

export interface ReadinessConfig {
  stableMs: number;
  maxWaitMs: number;
  pollMs: number;
  requireCanvas: boolean;
  requireFrameUrls: boolean;
  requireAnswerStable: boolean;
  answerStableRounds: number;
  readySelectors: string[];
}

export interface TriggerDelays {
  answerReadMs: number[];
  autoDetectFallbackMs: number;
  patchDebounceMs: number;
  frameCheckMs: number;
  newBoxDebounceMs: number;
}

export interface DetectionTuning {
  scoreWeights: { points: number; density: number; prior: number; ratio: number };
  groundGap: number;
  maxHeight: number;
  minSpan: number;
  minBoxLength: number;
  minBoxWidth: number;
  minBoxHeight: number;
  maxLength: number;
  maxWidth: number;
  maxHeightBox: number;
  ratioRange: [number, number];
  densityNorm: number;
  pointNorm: number;
  inflateMax: number;
  unknownPriorScore: number;
}

export interface FitTuning {
  minSize: number;
  maxInflate: number;
  shrinkFloor: number;
  minPoints: number;
  outlierPercentile: number;
  useClassSizeClamp: boolean;
  clampStrength: number;
}

export interface AssistConfig {
  enabled: boolean;
  /** 所有 /mark/practice/show/id/*\/page_id/* 及同类链接的准入规则 */
  urlRules: UrlRule[];
  /** 帧数来源优先级 */
  frameSources: FrameSourceId[];
  frameCountFallbackPolicy: 'strict' | 'max' | 'declared';
  /** 点云初始化完毕判定 */
  readiness: ReadinessConfig;
  /** 所有定时器/触发延迟 */
  delays: TriggerDelays;
  /** 类别尺寸先验（新增物体只加一行） */
  classProfiles: ClassProfile[];
  autoMapPlatformTypes: boolean;
  allowUnknownClass: boolean;
  classifyOnUserDraw: boolean;
  autoFitOnUserDraw: boolean;
  autoRotateOnUserDraw: boolean;
  /** 检测/贴合的全部数值参数 */
  detection: DetectionTuning;
  fitTuning: FitTuning;
  /** 平台原生能力别名表 */
  platformApi: PlatformApiMap;
  /** L0 配置改写白名单 */
  patchableToolConfigFields: ToolConfigField[];
  nativeOpsPrefer: boolean;
  nativeAutoFit: boolean;
  nativeMultiFrame: boolean;
  multiFrameBatch: boolean;
  guardManual: boolean;
  guardWholeTrack: boolean;
  guardUserWindowMs: number;
  assistGraceMs: number;
  enhancedFit: boolean;

  autoDetectOnOpen: boolean;
  autoDetectMultiFrame: boolean;
  autoDetectIfFewerThan: number;
  autoDetectTtlHours: number;
  autoApproveHighConfidence: boolean;
  autoApproveThreshold: number;
  detectConfidenceMin: number;
  detectVoxel: number;
  detectGroundPercentile: number;
  detectMinPoints: number;
  detectMaxClusters: number;
  detectClassPriors: boolean;
  dedupeIoU: number;
  useOrientedIoU: boolean;
  trackMatchDistance: number;
  trackSizeRatio: number;

  fitThreshold: number;
  outlierPercentile: number;
  maxPointsPerBox: number;
  detectMaxPoints: number;
  roiVoxel: number;
  frameCacheLimit: number;
  frameConcurrency: number;
  workerTimeouts: { detect: number; fit: number };
  idleSliceMs: number;
  theme: 'midnight' | 'sakura' | 'mint';
  showAvatar: boolean;
  typeSpeed: number;
  collapsed: boolean;
}

export interface GuardEntry {
  boxId: string;
  trackId?: string;
  frameId?: string;
  signature: string;
  params: { center: Vec3; size: Vec3; yaw: number };
  reason: string;
  at: number;
}

export interface FitDelta {
  boxId: string;
  frameId?: string;
  trackId?: string;
  center: Vec3;
  size: Vec3;
  yaw: number;
  score: number;
  pointCount: number;
  reason?: string;
}

export interface RuntimeStatus {
  task?: TaskInfo;
  frameIndex: number;
  boxCount: number;
  guardCount: number;
  candidateCount: number;
  pendingCount: number;
  approvedCount: number;
  autoDetected: boolean;
  lastAction: string;
  lastDetail: string;
  fitCount: number;
  skippedCount: number;
  nativeAutoFit: boolean;
  enhancedFit: boolean;
  hookReady: boolean;
  workerBusy: boolean;
  frameCount: number;
  frameCountSource: string;
  urlMatched: boolean;
  platformReady: boolean;
  readyDetail: string;
  nativeOpsLevel: 'L0' | 'L1' | 'L2' | 'none';
  lastNewBoxCount: number;
  updatedAt: number;
}

export interface FitRequest {
  boxId: string;
  center: Vec3;
  size: Vec3;
  yaw: number;
  /** ROI 内的点云，紧凑 x,y,z 排列 */
  points: Float32Array;
  outlierPercentile: number;
  maxPoints: number;
  threshold: number;
  fitTuning: FitTuning;
  classSize?: Vec3 | null;
}

export interface FitResult extends FitRequest {
  ok: boolean;
  center: Vec3;
  sizeOut: Vec3;
  yawOut: number;
  score: number;
  pointCount: number;
  elapsed: number;
  error?: string;
}

export interface DetectRequest {
  points: Float32Array;
  maxPoints: number;
  voxel: number;
  groundPercentile: number;
  minPoints: number;
  maxClusters: number;
  confidenceMin: number;
  outlierPercentile: number;
  fitThreshold: number;
  classPriors: ClassPrior[];
  tuning: DetectionTuning;
  profiles: ClassProfile[];
  platformTypes: PlatformTypeHint[];
  allowUnknownClass: boolean;
  autoMapPlatformTypes: boolean;
  idPrefix: string;
}

export interface DetectResult {
  ok: boolean;
  candidates: CandidateBox[];
  totalPoints: number;
  groundZ: number;
  elapsed: number;
  error?: string;
}

export interface PlatformReady {
  ready: boolean;
  at: number;
  reasons: string[];
  frameCount: number;
  frameUrls: number;
  canvas: boolean;
  answerStable: boolean;
  detail: string;
}

export interface PlatformProbe {
  ok: boolean;
  globalName?: string;
  kernelPath?: string;
  fitMethod?: string;
  createMethod?: string;
  frameCount?: number;
  frames?: number;
  fitButton?: string;
  level: 'L0' | 'L1' | 'L2' | 'none';
}

export interface NewBoxEvent {
  boxId: string;
  frameId?: string;
  center: Vec3;
  size: Vec3;
  yaw: number;
  at: number;
}

export interface Envelope<T = any> {
  type: string;
  payload?: T;
  tabId?: number;
}
