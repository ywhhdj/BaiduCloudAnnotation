import type {
  AssistConfig, ClassPrior, ClassProfile, DetectionTuning, FitTuning,
  PlatformApiMap, ReadinessConfig, RuntimeStatus, ToolConfigField, TriggerDelays, UrlRule,
} from './types';

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

/** 平台任务字段（全部来自上传的 百度众测平台.html，允许在设置页增补） */
export const TASK_INPUT_IDS = {
  markId: 'hide_mark_id',
  pageId: 'hide_page_id',
  totalPage: 'hide_total_page',
  opStatus: 'hide_op_status',
  frameSample: 'frame_sample',
  finalFrameCount: 'final_total_frame_count',
  question: 'question_json',
};

/** 解析平台答案时兼容的字段命名（不同题目模板/版本不一致） */
export const FIELD_ALIASES = {
  center: [
    'center',
    'centre',
    'position',
    'pos',
    'translation',
    'xyz',
    'center_point'
  ],
  size: [
    'size',
    'dimensions',
    'dimension',
    'dim',
    'lwh',
    'scale',
    'box_size',
    'extent'
  ],
  length: [
    'length',
    'l',
    'len',
    'dx'
  ],
  width: [
    'width',
    'w',
    'wid',
    'dy'
  ],
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

/** 页面快照确认的选择器（CSS Modules 带哈希，统一用前缀匹配）；可配置增补 */
export const DOM_SELECTORS = {
  topicSchema: '.topic-schema, [class*="topic-schema"]',
  configPanel: '[data-guide="pointCloudConfigPanel"]',
  frameList: '[class*="FramePagination_frameList"]',
  frameItem: '[class*="FramePagination_item"]',
  frameActive: '[class*="FramePagination_active"]',
  multiFrameModal: '[class*="multiFrameView"], [class*="multiFrame2DView"]',
  canvas: 'canvas',
  autoFitLabel: '自动贴合阈值',
  cloudRoot: '[id^="pointCloudMark-root-"], [data-guide="rightPanelAnd3dView"], [class*="Root_root"]',
  frameUrlDom: '#url',
  fitButton: '[class*="fitBox"], [class*="autoFit"], [data-guide*="fit"], button[title*="贴合"]',
};

/** unique 分隔符与段类型关键字（按内容识别，不依赖段索引） */
export const UNIQUE_FORMAT = {
  segmentSeparator: '#!#',
  itemSeparator: '@_@',
  zipHint: '.zip',
  lidarHint: 'framelidar',
  cameraHint: 'framecamera',
  calibHint: '{',
  maxSegmentScan: 32,
};

/** 所有 /mark/practice/show/id... */
export const DEFAULT_URL_RULES: UrlRule[] = [
  {
    id: 'practice-show',
    pattern: 'https://test.baidu.com/mark/practice/show/id/*/page_id/*',
    enabled: true,
    description: '练习答题页（含 filter/mode 尾缀）'
  },
  {
    id: 'practice-show-http',
    pattern: 'http://test.baidu.com/mark/practice/show/id/*/page_id/*',
    enabled: true,
    description: '练习答题页 http'
  },
  {
    id: 'practice-view',
    pattern: 'https://test.baidu.com/mark/practice/view/id/*/page_id/*',
    enabled: true,
    description: '练习查看页'
  },
  {
    id: 'test-show',
    pattern: 'https://test.baidu.com/mark/test/show/id/*/page_id/*',
    enabled: true,
    description: '考试答题页'
  },
  {
    id: 'task-do',
    pattern: 'https://test.baidu.com/mark/task/enterDo/id/*',
    enabled: true,
    description: '正式答题页'
  },
  {
    id: 'task-view',
    pattern: 'https://test.baidu.com/mark/task/view/id/*',
    enabled: true,
    description: '正式查看页'
  },
  {
    id: 'mark-generic',
    pattern: 'https://test.baidu.com/mark/*/show/id/*/page_id/*',
    enabled: true,
    description: '任意模块 show 页兜底'
  },
  {
    id: 'mark-fallback',
    pattern: 'https://test.baidu.com/mark/*',
    enabled: true,
    description: 'manifest 兜底（可在设置页关闭）'
  },
];

/** 默认类别尺寸先验：typeId 对齐平台 topic-schema.typeConfig（实测值），尺寸单位米 */
export const DEFAULT_CLASS_PROFILES: ClassProfile[] = [
  {
    id: 'car',
    name: '小型车 / 轿车',
    platformTypeId: 'car',
    aliases: ['小型车', '轿车', '小汽车', 'car'],
    size: [4.5, 1.8, 1.5],
    tolerance: 0.38,
    sizeRange: {
      l: [3.2, 5.8],
      w: [1.4, 2.3],
      h: [1.2, 2.0]
    },
    aspectRatio: [1.6, 4.2],
    minPoints: 12,
    minConfidence: 0.35,
    weight: 1,
    enabled: true
  },
  {
    id: 'pickup_truck',
    name: '皮卡',
    platformTypeId: 'pickup_truck',
    aliases: ['皮卡', 'pickup', 'pickup_truck'],
    size: [5.3, 2.0, 1.85],
    tolerance: 0.40,
    sizeRange: {
      l: [4.2, 6.6],
      w: [1.6, 2.5],
      h: [1.4, 2.3]
    },
    aspectRatio: [1.6, 4.0],
    minPoints: 12,
    minConfidence: 0.35,
    weight: 1,
    enabled: true
  },
  {
    id: 'truck',
    name: '卡车 / 大型车',
    platformTypeId: 'truck',
    aliases: ['卡车', '大型车', '货车', 'truck'],
    size: [9.0, 2.6, 3.2],
    tolerance: 0.45,
    sizeRange: {
      l: [6.0, 14.0],
      w: [2.0, 3.3],
      h: [2.2, 4.2]
    },
    aspectRatio: [1.8, 5.5],
    minPoints: 20, minConfidence: 0.35,
    weight: 1,
    enabled: true
  },
  {
    id: 'construction_vehicle',
    name: '工程车',
    platformTypeId: 'construction_vehicle',
    aliases: ['工程车', '挖掘机', 'construction'],
    size: [6.2, 2.6, 3.0],
    tolerance: 0.48,
    sizeRange: {
      l: [3.5, 10.0],
      w: [1.8, 3.4],
      h: [1.8, 4.2]
    },
    aspectRatio: [1.2, 4.5],
    minPoints: 18,
    minConfidence: 0.35,
    weight: 1,
    enabled: true
  },
  {
    id: 'bus',
    name: '公交车 / 大巴',
    platformTypeId: 'bus',
    aliases: ['公交车', '大巴', '客车', 'bus'],
    size: [11.5, 2.6, 3.2],
    tolerance: 0.45,
    sizeRange: {
      l: [8.0, 16.0],
      w: [2.1, 3.3],
      h: [2.4, 4.2]
    },
    aspectRatio: [2.4, 6.0],
    minPoints: 24,
    minConfidence: 0.35,
    weight: 1,
    enabled: true
  },
  {
    id: 'tricycle',
    name: '三轮车',
    platformTypeId: 'tricycle',
    aliases: ['三轮车', 'tricycle'],
    size: [2.6, 1.3, 1.6],
    tolerance: 0.48,
    sizeRange: {
      l: [1.6, 3.8],
      w: [0.9, 1.9],
      h: [1.0, 2.2]
    },
    aspectRatio: [1.1, 3.5],
    minPoints: 8,
    minConfidence: 0.32,
    weight: 1,
    enabled: true
  },
  {
    id: 'motorcycle',
    name: '摩托车 / 二轮车',
    platformTypeId: 'motorcycle',
    aliases: ['摩托车', '二轮车', '骑手', 'motorcycle'],
    size: [2.0, 0.85, 1.55],
    tolerance: 0.50,
    sizeRange: {
      l: [1.3, 3.0],
      w: [0.5, 1.4],
      h: [1.0, 2.1]
    },
    aspectRatio: [1.2, 4.0],
    minPoints: 7,
    minConfidence: 0.30,
    weight: 1,
    enabled: true
  },
  {
    id: 'bicycle',
    name: '自行车',
    platformTypeId: 'bicycle',
    aliases: ['自行车', '单车', 'bicycle'],
    size: [1.8, 0.7, 1.6],
    tolerance: 0.50,
    sizeRange: {
      l: [1.2, 2.8],
      w: [0.4, 1.2],
      h: [1.0, 2.1]
    },
    aspectRatio: [1.2, 4.0],
    minPoints: 7,
    minConfidence: 0.30,
    weight: 1,
    enabled: true
  },
  {
    id: 'person',
    name: '行人',
    platformTypeId: 'person',
    aliases: ['行人', '人', 'pedestrian', 'person'],
    size: [0.75, 0.75, 1.75],
    tolerance: 0.50,
    sizeRange: {
      l: [0.3, 1.3],
      w: [0.3, 1.3],
      h: [1.0, 2.2]
    },
    aspectRatio: [0.6, 1.8],
    minPoints: 5,
    minConfidence: 0.30,
    weight: 1,
    enabled: true
  },
  {
    id: 'animal',
    name: '动物',
    platformTypeId: 'animal',
    aliases: ['动物', 'animal'],
    size: [1.2, 0.6, 1.0],
    tolerance: 0.55,
    sizeRange: {
      l: [0.5, 2.2],
      w: [0.3, 1.2],
      h: [0.4, 1.8]
    },
    aspectRatio: [1.0, 4.0],
    minPoints: 5,
    minConfidence: 0.28,
    weight: 1,
    enabled: true
  },
  {
    id: 'traffic_cone',
    name: '交通锥 / 锥桶',
    platformTypeId: 'traffic_cone',
    aliases: ['交通锥', '锥桶', 'cone'],
    size: [0.45, 0.45, 0.75],
    tolerance: 0.60,
    sizeRange: {
      l: [0.2, 1.0],
      w: [0.2, 1.0],
      h: [0.3, 1.3]
    },
    aspectRatio: [0.5, 2.5],
    minPoints: 4,
    minConfidence: 0.28,
    weight: 1,
    enabled: true
  },
];

/** 兼容旧调用点的尺寸先验（结构保持 ClassPrior，内容由 ClassProfile 派生） */
export const CLASS_PRIORS: ClassPrior[] = DEFAULT_CLASS_PROFILES.map((p) => ({
  typeId: p.platformTypeId || p.id,
  name: p.name,
  size: [...p.size] as [number, number, number],
  tolerance: p.tolerance,
}));

/** 平台原生能力别名表：平台升级后只改这里，不改代码 */
export const DEFAULT_PLATFORM_API: PlatformApiMap = {
  globals: [
    '__PC_ASSIST_API__',
    'pointCloudKernel',
    '__POINT_CLOUD_KERNEL__',
    'platform',
    'crowdtestPointCloud'
  ],
  kernelPaths: [
    'kernel',
    'app.kernel',
    '__pcKernel',
    'pointCloudApp.kernel'
  ],
  fitMethodNames: [
    'fitBox',
    'autoFitBox',
    'fitSize',
    'autoFit',
    'fit',
    'handleAutoFit'
  ],
  createMethodNames: [
    'addBox',
    'createBox',
    'add_box',
    'newBox',
    'addElement'
  ],
  frameCountPaths: [
    'state.use().frameCount',
    'state.frameCount',
    'config.toolConfig.frameCount'
  ],
  framesPaths: [
    'state.use().frames',
    'frames',
    'state.frames'
  ],
  fitButtonSelectors: [
    '[class*="fitBox"]',
    '[class*="autoFit"]',
    '[data-guide*="fit"]',
    'button[title*="贴合"]'
  ],
};

/** L0：只改这些平台配置字段，绝不改题目数据/帧数/类别表 */
export const DEFAULT_PATCH_FIELDS: ToolConfigField[] = [
  {
    key: 'autoFitBox',
    value: true,
    enabled: true
  },
  {
    key: 'multiFrameMarkMode',
    value: true,
    enabled: true
  },
  {
    key: 'showFitSize',
    value: true,
    enabled: true
  },
  { 
    key: 'batchEdit',
    value: true,
    enabled: true
  },
];

export const DEFAULT_READINESS: ReadinessConfig = {
  stableMs: 320,
  maxWaitMs: 20000,
  pollMs: 240,
  requireCanvas: true,
  requireFrameUrls: true,
  requireAnswerStable: true,
  answerStableRounds: 2,
  readySelectors: [
    '[id^="pointCloudMark-root-"]',
    '[data-guide="rightPanelAnd3dView"]',
    '[class*="Root_root"]',
    'canvas',
    '.topic-schema, [class*="topic-schema"]',
  ],
};

export const DEFAULT_DELAYS: TriggerDelays = {
  answerReadMs: [600, 1800],
  autoDetectFallbackMs: 9000,
  patchDebounceMs: 60,
  frameCheckMs: 1500,
  newBoxDebounceMs: 220,
};

export const DEFAULT_DETECTION: DetectionTuning = {
  scoreWeights: { points: 0.34, density: 0.24, prior: 0.32, ratio: 0.10 },
  groundGap: 0.18,
  maxHeight: 9.5,
  minSpan: 0.2,
  minBoxLength: 0.3,
  minBoxWidth: 0.3,
  minBoxHeight: 0.35,
  maxLength: 25,
  maxWidth: 6,
  maxHeightBox: 5,
  ratioRange: [1.08, 5.5],
  densityNorm: 6,
  pointNorm: 120,
  inflateMax: 0.12,
  unknownPriorScore: 0.55,
};

export const DEFAULT_FIT_TUNING: FitTuning = {
  minSize: 0.15,
  maxInflate: 1.15,
  shrinkFloor: 0.15,
  minPoints: 8,
  outlierPercentile: 0.02,
  useClassSizeClamp: true,
  clampStrength: 0.35,
};

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
  MAIN_INJECT: 'MAIN_INJECT',
  MAIN_INJECT_FALLBACK: 'MAIN_INJECT_FALLBACK',
  ANSWER_SNAPSHOT: 'ANSWER_SNAPSHOT',
  PLATFORM_READY: 'PLATFORM_READY',
  PLATFORM_PROBE: 'PLATFORM_PROBE',
  NATIVE_OPS: 'NATIVE_OPS',
  NEW_BOXES: 'NEW_BOXES',
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
  importPlatformTypes: 'importPlatformTypes',
  resetClassProfiles: 'resetClassProfiles',
} as const;

export const BRIDGE_CHANNEL = '__PC_ASSIST_BRIDGE__';

export const DEFAULT_CONFIG: AssistConfig = {
  enabled: true,
  urlRules: DEFAULT_URL_RULES,
  frameSources: [
    'unique',
    'urlDom',
    'framePagination',
    'toolConfig',
    'finalFrameCount',
    'answerGroups',
    'platformKernel'
  ],
  frameCountFallbackPolicy: 'max',
  readiness: DEFAULT_READINESS,
  delays: DEFAULT_DELAYS,
  classProfiles: DEFAULT_CLASS_PROFILES,
  autoMapPlatformTypes: true,
  allowUnknownClass: true,
  classifyOnUserDraw: false,
  autoFitOnUserDraw: true,
  autoRotateOnUserDraw: true,
  detection: DEFAULT_DETECTION,
  fitTuning: DEFAULT_FIT_TUNING,
  platformApi: DEFAULT_PLATFORM_API,
  patchableToolConfigFields: DEFAULT_PATCH_FIELDS,
  nativeOpsPrefer: true,
  nativeAutoFit: true,
  nativeMultiFrame: true,
  multiFrameBatch: true,
  guardManual: true,
  guardWholeTrack: false,
  guardUserWindowMs: 1600,
  assistGraceMs: 2600,
  enhancedFit: false,
  autoDetectOnOpen: true,
  autoDetectMultiFrame: true,
  autoDetectIfFewerThan: 2,
  autoDetectTtlHours: 12,
  autoApproveHighConfidence: false,
  autoApproveThreshold: 0.82,
  detectConfidenceMin: 0.42,
  detectVoxel: 0.36,
  detectGroundPercentile: 0.06,
  detectMinPoints: 12,
  detectMaxClusters: 60,
  detectClassPriors: true,
  dedupeIoU: 0.35,
  useOrientedIoU: false,
  trackMatchDistance: 3.5,
  trackSizeRatio: 1.7,
  fitThreshold: 0.35,
  outlierPercentile: 0.02,
  maxPointsPerBox: 12000,
  detectMaxPoints: 60000,
  roiVoxel: 0.5,
  frameCacheLimit: 8,
  frameConcurrency: 2,
  workerTimeouts: { detect: 12000, fit: 4000 },
  idleSliceMs: 12,
  theme: 'midnight',
  showAvatar: true,
  typeSpeed: 24,
  collapsed: false,
};

/** manifest 静态域名白名单提示（新增点云域名只增补 manifest 一行，无需改代码） */
export const HOST_PERMISSION_HINTS = [
  'https://test.baidu.com/*',
  'http://test.baidu.com/*',
  'https://*.bcebos.com/*',
  'http://*.bcebos.com/*',
  'http://60.204.142.193:8080/*',
];

export const EMPTY_STATUS: RuntimeStatus = {
  frameIndex: 0,
  boxCount: 0,
  guardCount: 0,
  candidateCount: 0,
  pendingCount: 0,
  approvedCount: 0,
  autoDetected: false,
  lastAction: '待机',
  lastDetail: '等待平台点云初始化完毕后，我再把大部分框自动圈好并贴边～',
  fitCount: 0,
  skippedCount: 0,
  nativeAutoFit: true,
  enhancedFit: false,
  hookReady: false,
  workerBusy: false,
  frameCount: 0,
  frameCountSource: '',
  urlMatched: false,
  platformReady: false,
  readyDetail: '等待注入',
  nativeOpsLevel: 'none',
  lastNewBoxCount: 0,
  updatedAt: Date.now(),
};
