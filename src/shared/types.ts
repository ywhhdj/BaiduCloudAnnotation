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
  timestamp?: number;
  record?: string;
  aicvId?: string;
  calib?: any;
}

export interface TaskInfo {
  markId: string;
  pageId: string;
  frameCount: number;
  frames: FrameMeta[];
  toolConfig: Record<string, any>;
  topic?: string;
}

/** 常见目标类别的尺寸先验（米），用于自动框选时给候选打类别建议与置信度 */
export interface ClassPrior {
  typeId: string;
  name: string;
  size: Vec3;
  tolerance: number;
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

export interface AssistConfig {
  enabled: boolean;
  /** 改写平台 toolConfig.autoFitBox，让平台原生贴合新拉的框 */
  nativeAutoFit: boolean;
  /** 改写 toolConfig.multiFrameMarkMode */
  nativeMultiFrame: boolean;
  /** 一键对 frameCount 帧批量处理 */
  multiFrameBatch: boolean;
  /** 人工修改过的框永不自动改动 */
  guardManual: boolean;
  /** 人工改过一帧即锁整条轨迹（默认只锁该帧） */
  guardWholeTrack: boolean;
  /** Worker 自主 ROI+PCA/OBB 贴合（平台 autoFitBox 不可用时的增强通道） */
  enhancedFit: boolean;

  // ---- 自动框选 + 人工审批 ----
  /** 打开标注页时自动检测并生成大部分候选框 */
  autoDetectOnOpen: boolean;
  /** 自动框选覆盖多帧（沿用 toolConfig.frameCount） */
  autoDetectMultiFrame: boolean;
  /** 答案里已有框数超过该值时不再自动出框，避免覆盖已有成果 */
  autoDetectIfFewerThan: number;
  /** 高置信度候选自动标记为「已审批」，仍保留人工随时修改的权利 */
  autoApproveHighConfidence: boolean;
  autoApproveThreshold: number;
  /** 候选最低置信度，低于此值不出框 */
  detectConfidenceMin: number;
  /** 体素边长（米），越大越快、越粗 */
  detectVoxel: number;
  /** 地面分位：取该分位 z 作为地平面基准 */
  detectGroundPercentile: number;
  /** 单簇最少点数 */
  detectMinPoints: number;
  /** 每帧最多输出候选数 */
  detectMaxClusters: number;
  /** 是否用类别尺寸先验给候选打建议类别 */
  detectClassPriors: boolean;

  /** 贴合阈值：越小越贴合，越大越保守 */
  fitThreshold: number;
  /** 离群点分位裁剪，例如 0.02 */
  outlierPercentile: number;
  /** 单框参与计算的点数上限，超出做均匀抽稀 */
  maxPointsPerBox: number;
  /** 全帧自动检测时交给 Worker 的点数上限 */
  detectMaxPoints: number;
  /** requestIdleCallback 时间片 */
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
  /** 平台阈值：0 激进，1 保守；用于最小尺寸约束与收缩系数 */
  threshold: number;
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

export interface Envelope<T = any> {
  type: string;
  payload?: T;
  tabId?: number;
}
