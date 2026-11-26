import type { AssistConfig, ClassPrior, RuntimeStatus } from './types';

/** 平台答案落点：既可能是 AngularJS 的 hidden input，也可能是 React 写入的本地答案容器 */
export const ANSWER_INPUT_IDS = [
  'mark_answer_json',
  'user_answer_temp_json',
  'latest_answer_json',
  'latest_answer_info_json',
  'sample_answer_json',
  'quality_answer_json',
  'check_answer_json',
  'real_verify_answer',
  'quality_annotations',
  'verify_annotations',
  'final_verify_annotations',
  'admin_check_annotations',
  'question_json',
];

export const TASK_INPUT_IDS = {
  markId: 'hide_mark_id',
  pageId: 'hide_page_id',
  totalPage: 'hide_total_page',
  opStatus: 'hide_op_status',
  frameSample: 'frame_sample',
  finalFrameCount: 'final_total_frame_count',
};

/** 解析平台答案时兼容的字段命名（不同题目模板/版本不一致） */
export const FIELD_ALIASES = {
  center: ['center', 'centre', 'position', 'pos', 'translation', 'xyz', 'center_point'],
  size: ['size', 'dimensions', 'dimension', 'dim', 'lwh', 'scale', 'box_size', 'extent'],
  length: ['length', 'l', 'len', 'dx'],
  width: ['width', 'w', 'wid', 'dy'],
  height: ['height', 'h', 'hei', 'dz'],
  yaw: ['yaw', 'rotation', 'rotation_y', 'theta', 'heading', 'angle', 'rot_y', 'psi'],
  id: ['id', 'box_id', 'obj_id', 'objectId', 'uuid', 'boxId', 'instance_id'],
  track: ['trackId', 'track_id', 'track_id_str', 'object_id', 'objId', 'cube_index', 'cubeIndex', 'tracking_id'],
  frame: ['frameId', 'frame_id', 'frame', 'frame_index', 'frameIndex', 'timestamp', 'frame_name'],
  type: ['typeId', 'type_id', 'type', 'label', 'category', 'class', 'obj_type'],
  source: ['source', 'from', 'origin', 'createBy', 'created_by', 'auto', 'isPredict', 'is_predict', 'predict'],
  manual: ['manual', 'isManual', 'is_manual', 'human', 'isHuman', 'is_human', 'modified', 'isModified', 'is_modified', 'edited', 'userEdited', 'user_edited', 'touched'],
  boxes: ['boxes', 'bbox', 'bboxes', 'objects', 'objs', 'cubes', 'cuboids', 'marks', 'annotations', 'results', 'result', 'labels', 'rects', '3d', '3d_boxes', 'box3d', 'frame_boxes', 'data'],
};

/** 页面快照确认的配置面板 / 帧列表 / 3D 视口选择器（CSS Modules 带哈希，统一用前缀匹配） */
export const DOM_SELECTORS = {
  topicSchema: '.topic-schema, [class*="topic-schema"]',
  configPanel: '[data-guide="pointCloudConfigPanel"]',
  frameList: '[class*="FramePagination_frameList"]',
  frameItem: '[class*="FramePagination_item"]',
  frameActive: '[class*="FramePagination_active"]',
  multiFrameModal: '[class*="multiFrameView"], [class*="multiFrame2DView"]',
  canvas: 'canvas',
  autoFitLabel: '自动贴合阈值',
};

/** 自动框选的类别尺寸先验（米，长/宽/高），按页面 typeConfig 的 typeId 命名 */
export const CLASS_PRIORS: ClassPrior[] = [
  { typeId: 'smallMot', name: '小汽车', size: [4.3, 1.8, 1.55], tolerance: 0.42 },
  { typeId: 'bigMot', name: '大型车', size: [9.0, 2.6, 3.2], tolerance: 0.45 },
  { typeId: 'OnlyTricycle', name: '三轮车', size: [2.6, 1.3, 1.6], tolerance: 0.45 },
  { typeId: 'OnlyBicycle', name: '二轮车', size: [1.9, 0.85, 1.6], tolerance: 0.5 },
  { typeId: 'pedestrian', name: '行人', size: [0.75, 0.75, 1.75], tolerance: 0.5 },
  { typeId: 'trafficCone', name: '锥桶', size: [0.45, 0.45, 0.75], tolerance: 0.6 },
];

export const STORAGE_KEYS = {
  config: 'pc_assist_config',
  guards: 'pc_assist_guards',
  approvals: 'pc_assist_approvals',
  boxTemplate: 'pc_assist_box_template',
  autoDetectDone: 'pc_assist_auto_detect_done',
  status: 'pc_assist_runtime_status',
  pcdCache: 'pc_assist_pcd_cache',
};

export const MSG = {
  // page(MAIN) -> content(ISOLATED) 走 window.postMessage，单独用 CHANNEL
  MAIN_INJECT: 'MAIN_INJECT',
  MAIN_INJECT_FALLBACK: 'MAIN_INJECT_FALLBACK',
  ANSWER_SNAPSHOT: 'ANSWER_SNAPSHOT',
  TASK_READY: 'TASK_READY',
  FRAME_CHANGED: 'FRAME_CHANGED',
  CONFIG_GET: 'CONFIG_GET',
  CONFIG_SET: 'CONFIG_SET',
  CONFIG_CHANGED: 'CONFIG_CHANGED',
  STATUS_GET: 'STATUS_GET',
  STATUS_SET: 'STATUS_SET',
  STATUS_PUSH: 'STATUS_PUSH',
  GUARD_LIST: 'GUARD_LIST',
  GUARD_ADD: 'GUARD_ADD',
  GUARD_CLEAR: 'GUARD_CLEAR',
  GUARDS_CHANGED: 'GUARDS_CHANGED',
  APPROVAL_LIST: 'APPROVAL_LIST',
  APPROVAL_SET: 'APPROVAL_SET',
  APPROVAL_CLEAR: 'APPROVAL_CLEAR',
  UI_ACTION: 'UI_ACTION',
  TOAST: 'TOAST',
  FETCH_PCD: 'FETCH_PCD',
  FETCH_FRAME_POINTS: 'FETCH_FRAME_POINTS',
  APPLY_PATCH: 'APPLY_PATCH',
  RELOAD: 'RELOAD',
  PING: 'PING',
} as const;

export const UI_ACTION = {
  fitCurrent: 'fitCurrent',
  fitAllFrames: 'fitAllFrames',
  showGuards: 'showGuards',
  clearGuards: 'clearGuards',
  autoDetect: 'autoDetect',
  autoDetectAllFrames: 'autoDetectAllFrames',
  showApprovals: 'showApprovals',
  approveAll: 'approveAll',
  approveHigh: 'approveHigh',
  rejectAll: 'rejectAll',
  approveOne: 'approveOne',
  rejectOne: 'rejectOne',
  clearApprovals: 'clearApprovals',
  toggleEnabled: 'toggleEnabled',
  toggleNative: 'toggleNative',
  toggleEnhanced: 'toggleEnhanced',
  toggleMultiFrame: 'toggleMultiFrame',
  reloadConfig: 'reloadConfig',
  collapse: 'collapse',
} as const;

export const BRIDGE_CHANNEL = '__PC_ASSIST_BRIDGE__';

export const DEFAULT_CONFIG: AssistConfig = {
  enabled: true,
  nativeAutoFit: true,
  nativeMultiFrame: true,
  multiFrameBatch: true,
  guardManual: true,
  guardWholeTrack: false,
  enhancedFit: false,

  autoDetectOnOpen: true,
  autoDetectMultiFrame: true,
  autoDetectIfFewerThan: 2,
  autoApproveHighConfidence: false,
  autoApproveThreshold: 0.82,
  detectConfidenceMin: 0.42,
  detectVoxel: 0.36,
  detectGroundPercentile: 0.06,
  detectMinPoints: 12,
  detectMaxClusters: 60,
  detectClassPriors: true,

  fitThreshold: 0.35,
  outlierPercentile: 0.02,
  maxPointsPerBox: 12000,
  detectMaxPoints: 60000,
  idleSliceMs: 12,
  theme: 'midnight',
  showAvatar: true,
  typeSpeed: 24,
  collapsed: false,
};

export const EMPTY_STATUS: RuntimeStatus = {
  frameIndex: 0,
  boxCount: 0,
  guardCount: 0,
  candidateCount: 0,
  pendingCount: 0,
  approvedCount: 0,
  autoDetected: false,
  lastAction: '待机',
  lastDetail: '前辈，我先把大部分框自动圈好，你只管审批和微调就好～',
  fitCount: 0,
  skippedCount: 0,
  nativeAutoFit: true,
  enhancedFit: false,
  hookReady: false,
  workerBusy: false,
  updatedAt: Date.now(),
};
