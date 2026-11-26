<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAssist } from '../../shared/useAssist'
import { useConfigBinder } from '../../shared/useConfigBinder'
import type { AssistConfig, ClassProfile, FrameSourceId, UrlRule } from '../../shared/types'
import {
  Btn,
  Note,
  Number,
  Options,
  Range,
  Row,
  Section,
  Switch,
  SwitchRow,
  Textarea,
} from '../../components/index'

const { status, config, patchConfig, patchProfiles, action, UI_ACTION } = useAssist()
const bind = useConfigBinder(patchConfig, () => config.value)
const frameCount = computed(() => status.value.frameCount || status.value.task?.frameCount || 0)

const setTheme = (e: Event) =>
  patchConfig({
    theme: (e.target as HTMLSelectElement).value as AssistConfig['theme']
  })
const act = (a: string) => action(a)

/* ---- 类别尺寸表 ---- */
function setProfile(
  i: number,
  key: keyof ClassProfile,
  e: Event | boolean | string | string[] | number
) {
  const value =
    typeof e === 'object' && e && 'target' in e
      ? (e.target as HTMLInputElement).type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : (e.target as HTMLInputElement).value
      : e
  const next = config.value.classProfiles.map((p: any, idx: number) =>
    idx === i ? { ...p, [key]: value } : p
  )
  void patchProfiles(next)
}
function setProfileSize(i: number, axis: number, v: number) {
  const value = Number.isFinite(v) && v > 0 ? v : 0.1
  const next = config.value.classProfiles.map((p: { size: any }, idx: number) => {
    if (idx !== i) return p
    const size = [...p.size] as [number, number, number]
    size[axis] = value
    return { ...p, size }
  })
  void patchProfiles(next)
}
function addProfile() {
  const p: ClassProfile = {
    id: `custom_${Date.now().toString(36)}`,
    name: '新物体',
    aliases: ['新物体'],
    size: [4.5, 1.8, 1.5],
    tolerance: 0.45,
    enabled: true,
    weight: 1,
  }
  void patchProfiles([
    ...config.value.classProfiles,
    p
  ])
}
function removeProfile(i: number) {
  void patchProfiles(config.value.classProfiles.filter((_: any, idx:number) => idx !== i))
}

/* ---- JSON 编辑 ---- */
const profilesJson = ref('')
const urlRulesJson = ref('')
const platformApiJson = ref('')
const jsonTouched = {
  profiles: false,
  rules: false,
  api: false
}

watch(
  () => config.value.classProfiles,
  (v) => {
    if (!jsonTouched.profiles) profilesJson.value = JSON.stringify(v, null, 2)
  },
  { immediate: true }
)
watch(
  () => config.value.urlRules,
  (v) => {
    if (!jsonTouched.rules) urlRulesJson.value = JSON.stringify(v, null, 2)
  },
  { immediate: true }
)
watch(
  () => config.value.platformApi,
  (v) => {
    if (!jsonTouched.api) platformApiJson.value = JSON.stringify(v, null, 2)
  },
  { immediate: true }
)

function importProfiles() {
  try {
    const arr = JSON.parse(profilesJson.value)
    if (Array.isArray(arr)) {
      jsonTouched.profiles = true
      void patchProfiles(arr)
    }
  } catch { /* 忽略非法 JSON */ }
}
function importUrlRules() {
  try {
    const arr = JSON.parse(urlRulesJson.value)
    if (Array.isArray(arr)) {
      jsonTouched.rules = true
      void patchConfig({ urlRules: arr as UrlRule[] })
    }
  } catch { /* 忽略非法 JSON */ }
}
function importPlatformApi() {
  try {
    const obj = JSON.parse(platformApiJson.value)
    if (obj && typeof obj === 'object') {
      jsonTouched.api = true
      void patchConfig({ platformApi: obj })
    }
  } catch { /* 忽略非法 JSON */ }
}
function exportJson(kind: 'profiles' | 'rules' | 'api') {
  if (kind === 'profiles') profilesJson.value = JSON.stringify(config.value.classProfiles, null, 2)
  if (kind === 'rules') urlRulesJson.value = JSON.stringify(config.value.urlRules, null, 2)
  if (kind === 'api') platformApiJson.value = JSON.stringify(config.value.platformApi, null, 2)
}

/* ---- 帧数来源 / 字段白名单 / 答案延迟 ---- */
const allSources: Array<{ id: FrameSourceId; label: string }> = [
  { id: 'unique', label: 'question_json.unique 段' },
  { id: 'urlDom', label: 'DOM #url 列表' },
  { id: 'framePagination', label: '帧分页 DOM' },
  { id: 'toolConfig', label: 'topic-schema.frameCount' },
  { id: 'finalFrameCount', label: 'final_total_frame_count' },
  { id: 'answerGroups', label: '答案帧分组' },
  { id: 'platformKernel', label: '平台内核 frameCount' },
]
function toggleSource(id: FrameSourceId, on: boolean) {
  const cur = config.value.frameSources || []
  const next = on ? Array.from(new Set([...cur, id])) : cur.filter((s: any) => s !== id)
  void patchConfig({ frameSources: next })
}
function toggleField(key: string, on: boolean) {
  void patchConfig({
    patchableToolConfigFields: config.value.patchableToolConfigFields.map((f: { key: string }) =>
      f.key === key ? {
        ...f,
        enabled: on
      } : f
    ),
  })
}
function setAnswerRead(e: Event) {
  const list = String((e.target as HTMLInputElement).value || '')
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
  void patchConfig({
    delays: {
      ...config.value.delays,
      answerReadMs: list
    }
  })
}
</script>

<template>
  <div
    class="pc-root pc-page"
    :class="`theme-${config.theme}`"
  >
    <div class="pc-title">点云贴边助手 · 设置（2.0）</div>
    <div class="pc-sub">
      自动保存并即时下发 · URL {{ status.urlMatched ? '已命中' : '未命中' }} ·
      真实帧数 <b>{{ frameCount }}</b>（{{ status.frameCountSource || '等待解析' }}） ·
      点云 {{ status.platformReady ? '已就绪' : status.readyDetail }} ·
      候选 {{ status.candidateCount }} / 待审 {{ status.pendingCount }} / 守护 {{ status.guardCount }}
    </div>

    <!-- ① 类别与尺寸先验 -->
    <Section title="① 类别与尺寸先验">
      <Note>
        每行的「长 / 宽 / 高（米）+ 容差」用于按点云簇尺寸近似判定类别；平台 typeId 留空时会按名称/别名自动对齐
        <code>topic-schema.typeConfig</code>
      </Note>

      <Row
        v-for="(p, i) in config.classProfiles"
        :key="p.id"
      >
        <template #label>
          <input
            type="text"
            :value="p.name"
            style="width: 130px"
            @change="setProfile(i, 'name', $event)"
          />
          <small>
            typeId
            <input
              type="text"
              :value="p.platformTypeId || ''"
              placeholder="自动映射"
              style="width: 110px"
              @change="setProfile(i, 'platformTypeId', $event)"
            />
            别名
            <input
              type="text"
              :value="(p.aliases || []).join(',')"
              style="width: 150px"
              @change="
                setProfile(
                  i,
                  'aliases',
                  String(($event.target as HTMLInputElement).value).split(',')
                )
                "
            />
          </small>
        </template>
        <div>
          <Number
            label="长"
            :model-value="p.size[0]"
            :step="0.1"
            :min="0.1"
            :width="62"
            @update:model-value="(v: number) => setProfileSize(i, 0, v)"
          />
          <Number
            label="宽"
            :model-value="p.size[1]"
            :step="0.1"
            :min="0.1"
            :width="62"
            @update:model-value="(v: number) => setProfileSize(i, 1, v)"
          />
          <Number
            label="高"
            :model-value="p.size[2]"
            :step="0.1"
            :min="0.1"
            :width="62"
            @update:model-value="(v: number) => setProfileSize(i, 2, v)"
          />
          <Number
            label="容差"
            :model-value="p.tolerance"
            :step="0.05"
            :min="0.05"
            :max="2"
            :width="62"
            @update:model-value="(v: string | number | boolean | Event | string[]) => setProfile(i, 'tolerance', v)"
          />
          <label>
            <Switch
              :model-value="p.enabled"
              @update:model-value="(v: string | number | boolean | Event | string[]) => setProfile(i, 'enabled', v)"
            />
            启用
          </label>
          <Btn @click="removeProfile(i)">删</Btn>
        </div>
      </Row>

      <Options style="margin-top: 10px">
        <Btn
          variant="primary"
          @click="addProfile"
        >＋ 新增物体</Btn>
        <Btn @click="act(UI_ACTION.importPlatformTypes)">⌁ 从平台 typeConfig 导入骨架</Btn>
        <Btn @click="act(UI_ACTION.resetClassProfiles)">↺ 恢复默认</Btn>
        <Btn @click="exportJson('profiles')">⇩ 导出 JSON</Btn>
      </Options>

      <Note>批量编辑：粘贴 ClassProfile[] JSON；保存后自动归一化（只填 name + size 也能用）</Note>
      <Textarea
        v-model="profilesJson"
        :rows="5"
      />
      <Btn @click="importProfiles">保存类别表 JSON</Btn>

      <SwitchRow
        :model-value="config.detectClassPriors"
        label="使用类别尺寸先验"
        @update:model-value="bind.bool('detectClassPriors')"
      />
      <SwitchRow
        :model-value="config.autoMapPlatformTypes"
        label="自动映射平台 typeId"
        desc="按名称/别名对齐 topic-schema.typeConfig；匹配不上时不写类别字段"
        @update:model-value="bind.bool('autoMapPlatformTypes')"
      />
      <SwitchRow
        :model-value="config.allowUnknownClass"
        label="允许未知类别"
        desc="尺寸不命中任何先验时仍输出通用候选框"
        @update:model-value="bind.bool('allowUnknownClass')"
      />
    </Section>

    <!-- ② 链接规则与帧数 -->
    <Section title="② 链接规则与帧数（帧数自动获取，不固定）">
      <Row
        label="URL 规则"
        desc="所有 /mark/practice/show/id/*/page_id/* 及同类链接；* 含 / 与尾缀 filter/mode"
      />
      <Textarea
        v-model="urlRulesJson"
        :rows="6"
      />
      <Options>
        <Btn @click="importUrlRules">保存 URL 规则</Btn>
        <Btn @click="exportJson('rules')">⇩ 导出</Btn>
      </Options>

      <Row
        label="帧数来源（多选，交叉校验）"
        :desc="`当前：${status.frameCountSource || '等待解析'}`"
      />
      <SwitchRow
        v-for="s in allSources"
        :key="s.id"
        :model-value="(config.frameSources || []).includes(s.id)"
        :label="s.label"
        @update:model-value="(v: boolean) => toggleSource(s.id, v)"
      />

      <Row
        label="帧数取值策略"
        desc="max=多来源取最大；strict=只用首个有效；declared=优先 toolConfig"
      >
        <select
          :value="config.frameCountFallbackPolicy"
          @change="
            patchConfig({
              frameCountFallbackPolicy: ($event.target as HTMLSelectElement).value as any,
            })
            "
        >
          <option value="max">max（推荐）</option>
          <option value="strict">strict</option>
          <option value="declared">declared</option>
        </select>
      </Row>

      <Note>
        代码里不存在默认 5 帧，也不会补 <code>fallback-*</code> 假帧；没有点云地址的帧只跳过，帧数仍是真实值。
      </Note>
    </Section>

    <!-- ③ 点云就绪与触发时机 -->
    <Section title="点云就绪与触发时机（事件驱动）">
      <Row label="稳定窗口 (ms)">
        <Number
          :model-value="config.readiness.stableMs"
          :min="0"
          :step="40"
          @update:model-value="bind.nestedNum('readiness', 'stableMs')"
        />
      </Row>
      <Row
        label="最长等待 (ms)"
        desc="超时后按兜底延迟再试一次，不改动已有数据"
      >
        <Number
          :model-value="config.readiness.maxWaitMs"
          :min="1000"
          :step="1000"
          @update:model-value="bind.nestedNum('readiness', 'maxWaitMs')"
        />
      </Row>
      <Row label="答案稳定轮数">
        <Number
          :model-value="config.readiness.answerStableRounds"
          :min="1"
          :max="10"
          @update:model-value="bind.nestedNum('readiness', 'answerStableRounds')"
        />
      </Row>
      <Row label="轮询间隔 (ms)">
        <Number
          :model-value="config.readiness.pollMs"
          :min="60"
          :step="20"
          @update:model-value="bind.nestedNum('readiness', 'pollMs')"
        />
      </Row>

      <Row label="要求 canvas / 帧地址">
        <div>
          <label>
            <Switch
              :model-value="config.readiness.requireCanvas"
              @update:model-value="bind.nestedBool('readiness', 'requireCanvas')"
            />
            canvas
          </label>
          <label>
            <Switch
              :model-value="config.readiness.requireFrameUrls"
              @update:model-value="bind.nestedBool('readiness', 'requireFrameUrls')"
            />
            帧地址
          </label>
        </div>
      </Row>

      <Row label="答案读取延迟（逗号分隔 ms）">
        <input
          type="text"
          :value="(config.delays.answerReadMs || []).join(', ')"
          @change="setAnswerRead"
        />
      </Row>
      <Row label="就绪超时兜底延迟 (ms)">
        <Number
          :model-value="config.delays.autoDetectFallbackMs"
          :min="500"
          :step="500"
          @update:model-value="bind.nestedNum('delays', 'autoDetectFallbackMs')"
        />
      </Row>
      <Row label="新框贴边去抖 (ms)">
        <Number
          :model-value="config.delays.newBoxDebounceMs"
          :min="60"
          :step="20"
          @update:model-value="bind.nestedNum('delays', 'newBoxDebounceMs')"
        />
      </Row>
      <Row label="帧检查间隔 (ms)">
        <Number
          :model-value="config.delays.frameCheckMs"
          :min="200"
          :step="100"
          @update:model-value="bind.nestedNum('delays', 'frameCheckMs')"
        />
      </Row>
    </Section>

    <!-- ④ 自动框选 + 人工审批 -->
    <Section title="④ 自动框选 + 人工审批（核心流程）">
      <SwitchRow
        :model-value="config.autoDetectOnOpen"
        label="打开页面自动框选"
        desc="点云初始化完毕后自动检测大部分目标、贴边生成候选框"
        @update:model-value="bind.bool('autoDetectOnOpen')"
      />
      <SwitchRow
        :model-value="config.autoDetectMultiFrame"
        label="自动框选覆盖多帧"
        desc="一次跑完真实帧数，并按中心距离关联同一轨迹"
        @update:model-value="bind.bool('autoDetectMultiFrame')"
      />
      <Row label="已有框数阈值">
        <Number
          :model-value="config.autoDetectIfFewerThan"
          :min="0"
          :max="50"
          :step="1"
          @update:model-value="bind.num('autoDetectIfFewerThan')"
        />
      </Row>
      <Row
        label="去重 IoU 阈值"
        desc="与已有人工/预标注框重叠超过此值的候选直接丢弃"
      >
        <Number
          :model-value="config.dedupeIoU"
          :min="0.05"
          :max="0.95"
          :step="0.05"
          @update:model-value="bind.num('dedupeIoU')"
        />
      </Row>
      <SwitchRow
        :model-value="config.useOrientedIoU"
        label="朝向感知 IoU"
        @update:model-value="bind.bool('useOrientedIoU')"
      />
      <Row label="轨迹关联距离 (m)">
        <Number
          :model-value="config.trackMatchDistance"
          :min="0.5"
          :max="12"
          :step="0.5"
          @update:model-value="bind.num('trackMatchDistance')"
        />
      </Row>
      <Row label="轨迹尺寸比上限">
        <Number
          :model-value="config.trackSizeRatio"
          :min="1.1"
          :max="3"
          :step="0.1"
          @update:model-value="bind.num('trackSizeRatio')"
        />
      </Row>
      <SwitchRow
        :model-value="config.autoApproveHighConfidence"
        label="高置信度自动通过"
        @update:model-value="bind.bool('autoApproveHighConfidence')"
      />
      <Row label="自动通过阈值">
        <Range
          :model-value="config.autoApproveThreshold"
          :min="0.5"
          :max="0.98"
          :step="0.02"
          @update:model-value="bind.num('autoApproveThreshold')"
        />
      </Row>
      <Row label="候选最低置信度">
        <Range
          :model-value="config.detectConfidenceMin"
          :min="0.2"
          :max="0.8"
          :step="0.02"
          @update:model-value="bind.num('detectConfidenceMin')"
        />
      </Row>
      <Row label="体素边长 (m)">
        <Range
          :model-value="config.detectVoxel"
          :min="0.2"
          :max="0.8"
          :step="0.04"
          @update:model-value="bind.num('detectVoxel')"
        />
      </Row>
      <Row label="地面分位 / 单簇最少点数 / 每帧最多候选">
        <div>
          <Number
            :model-value="config.detectGroundPercentile"
            :min="0.02"
            :max="0.2"
            :step="0.01"
            @update:model-value="bind.num('detectGroundPercentile')"
          />
          <Number
            :model-value="config.detectMinPoints"
            :min="4"
            :max="200"
            :step="2"
            @update:model-value="bind.num('detectMinPoints')"
          />
          <Number
            :model-value="config.detectMaxClusters"
            :min="5"
            :max="200"
            :step="5"
            @update:model-value="bind.num('detectMaxClusters')"
          />
        </div>
      </Row>
      <Row
        label="置信度权重"
        desc="点数 / 密度 / 类别先验 / 长宽比，自动归一化"
      >
        <div>
          <Number
            :model-value="config.detection.scoreWeights.points"
            :step="0.02"
            :min="0"
            :width="58"
            @update:model-value="(v: any) =>
              bind.nested('detection', 'scoreWeights')({
                ...config.detection.scoreWeights,
                points: v,
              })
              "
          />
          <Number
            :model-value="config.detection.scoreWeights.density"
            :step="0.02"
            :min="0"
            :width="58"
            @update:model-value="(v: any) =>
              bind.nested('detection', 'scoreWeights')({
                ...config.detection.scoreWeights,
                density: v,
              })
              "
          />
          <Number
            :model-value="config.detection.scoreWeights.prior"
            :step="0.02"
            :min="0"
            :width="58"
            @update:model-value="(v: any) =>
              bind.nested('detection', 'scoreWeights')({
                ...config.detection.scoreWeights,
                prior: v,
              })
              "
          />
          <Number
            :model-value="config.detection.scoreWeights.ratio"
            :step="0.02"
            :min="0"
            :width="58"
            @update:model-value="(v: any) =>
              bind.nested('detection', 'scoreWeights')({
                ...config.detection.scoreWeights,
                ratio: v,
              })
              "
          />
        </div>
      </Row>
      <Row label="尺寸上限 长/宽/高 (m)">
        <div>
          <Number
            :model-value="config.detection.maxLength"
            :step="0.5"
            :width="62"
            @update:model-value="bind.nestedNum('detection', 'maxLength')"
          />
          <Number
            :model-value="config.detection.maxWidth"
            :step="0.2"
            :width="62"
            @update:model-value="bind.nestedNum('detection', 'maxWidth')"
          />
          <Number
            :model-value="config.detection.maxHeightBox"
            :step="0.2"
            :width="62"
            @update:model-value="bind.nestedNum('detection', 'maxHeightBox')"
          />
        </div>
      </Row>
      <Row label="地面裁剪 / 最大高度 / 轻微外扩">
        <div>
          <Number
            :model-value="config.detection.groundGap"
            :step="0.05"
            :width="62"
            @update:model-value="bind.nestedNum('detection', 'groundGap')"
          />
          <Number
            :model-value="config.detection.maxHeight"
            :step="0.5"
            :width="62"
            @update:model-value="bind.nestedNum('detection', 'maxHeight')"
          />
          <Number
            :model-value="config.detection.inflateMax"
            :step="0.02"
            :width="62"
            @update:model-value="bind.nestedNum('detection', 'inflateMax')"
          />
        </div>
      </Row>

      <Options style="margin-top: 10px">
        <Btn
          variant="primary"
          @click="act('autoDetect')"
        >◎ 立即自动框选</Btn>
        <Btn
          variant="primary"
          @click="act('autoDetectAllFrames')"
        >◎ 多帧框选</Btn>
        <Btn @click="act('approveAll')">✓ 全部通过</Btn>
        <Btn @click="act('approveHigh')">✓ 高置信通过</Btn>
        <Btn @click="act('rejectAll')">✕ 全部拒绝</Btn>
        <Btn @click="act('showApprovals')">⌁ 审批清单</Btn>
      </Options>
    </Section>

    <!-- ⑤ 平台原生操作 / 用户拉框闭环 -->
    <Section title="平台原生操作 / 用户拉框闭环">
      <SwitchRow
        :model-value="config.nativeOpsPrefer"
        label="优先平台原生贴合（L1）"
        desc="探测内核 fitBox / 自动贴合按钮；失败才用 Worker 只改几何"
        @update:model-value="bind.bool('nativeOpsPrefer')"
      />
      <SwitchRow
        :model-value="config.autoRotateOnUserDraw"
        label="用户拉框后自动旋转"
        @update:model-value="bind.bool('autoRotateOnUserDraw')"
      />
      <SwitchRow
        :model-value="config.autoFitOnUserDraw"
        label="用户拉框后自动贴边"
        @update:model-value="bind.bool('autoFitOnUserDraw')"
      />
      <SwitchRow
        :model-value="config.classifyOnUserDraw"
        label="显示尺寸类别建议"
        desc="只提示，默认不改写平台类别字段（保持原数据）"
        @update:model-value="bind.bool('classifyOnUserDraw')"
      />
      <Row label="L0 配置改写字段白名单">
        <div>
          <label
            v-for="f in config.patchableToolConfigFields"
            :key="f.key"
            style="margin-right: 10px"
          >
            <Switch
              :model-value="f.enabled"
              @update:model-value="(v: boolean) => toggleField(f.key, v)"
            />
            {{ f.key }}
          </label>
        </div>
      </Row>

      <Row
        label="平台 API 别名表"
        desc="平台升级后只改这里，不改代码"
      />
      <Textarea
        v-model="platformApiJson"
        :rows="5"
      />
      <Options>
        <Btn @click="importPlatformApi">保存别名表</Btn>
        <Btn @click="exportJson('api')">⇩ 导出</Btn>
      </Options>
    </Section>

    <!-- ⑥ 贴合策略 -->
    <Section title="贴合策略">
      <SwitchRow
        :model-value="config.enabled"
        label="启用助手"
        desc="关闭后插件只读不写，不改写平台任何配置"
        @update:model-value="bind.bool('enabled')"
      />
      <SwitchRow
        :model-value="config.nativeAutoFit"
        label="平台原生自动贴合（主路径）"
        @update:model-value="bind.bool('nativeAutoFit')"
      />
      <SwitchRow
        :model-value="config.nativeMultiFrame"
        label="平台多帧标注模式"
        desc="帧数沿用题目真实帧数"
        @update:model-value="bind.bool('nativeMultiFrame')"
      />
      <SwitchRow
        :model-value="config.enhancedFit"
        label="增强贴合（Worker 通道）"
        @update:model-value="bind.bool('enhancedFit')"
      />
      <SwitchRow
        :model-value="config.multiFrameBatch"
        :label="`多帧批量（当前 ${frameCount} 帧）`"
        desc="一次处理所有真实帧"
        @update:model-value="bind.bool('multiFrameBatch')"
      />
      <Row label="贴合阈值">
        <Range
          :model-value="config.fitThreshold"
          :min="0"
          :max="0.9"
          :step="0.05"
          @update:model-value="bind.num('fitThreshold')"
        />
      </Row>
      <Row label="离群点裁剪分位 / 最小尺寸 / 最大膨胀">
        <div>
          <Number
            :model-value="config.fitTuning.outlierPercentile"
            :step="0.01"
            :min="0"
            :max="0.15"
            :width="62"
            @update:model-value="bind.nestedNum('fitTuning', 'outlierPercentile')"
          />
          <Number
            :model-value="config.fitTuning.minSize"
            :step="0.05"
            :min="0.05"
            :width="62"
            @update:model-value="bind.nestedNum('fitTuning', 'minSize')"
          />
          <Number
            :model-value="config.fitTuning.maxInflate"
            :step="0.05"
            :min="1"
            :width="62"
            @update:model-value="bind.nestedNum('fitTuning', 'maxInflate')"
          />
        </div>
      </Row>
      <SwitchRow
        :model-value="config.fitTuning.useClassSizeClamp"
        label="类别尺寸软钳制"
        desc="贴合时避免框被撑爆或压得过小"
        @update:model-value="bind.nestedBool('fitTuning', 'useClassSizeClamp')"
      />
    </Section>

    <!-- ⑦ 人工修改守护 / 去重 TTL -->
    <Section title="⑦ 人工修改守护 / 去重 TTL">
      <SwitchRow
        :model-value="config.guardManual"
        label="守护人工修改过的框"
        @update:model-value="bind.bool('guardManual')"
      />
      <SwitchRow
        :model-value="config.guardWholeTrack"
        label="整轨守护"
        @update:model-value="bind.bool('guardWholeTrack')"
      />
      <Row label="用户交互窗口 (ms)">
        <Number
          :model-value="config.guardUserWindowMs"
          :min="200"
          :step="100"
          @update:model-value="bind.num('guardUserWindowMs')"
        />
      </Row>
      <Row label="插件写入宽限 (ms)">
        <Number
          :model-value="config.assistGraceMs"
          :min="200"
          :step="100"
          @update:model-value="bind.num('assistGraceMs')"
        />
      </Row>
      <Row
        label="自动检测去重有效期 (h)"
        desc="改配置/类别后自动失效，可直接重跑"
      >
        <Number
          :model-value="config.autoDetectTtlHours"
          :min="0"
          :max="72"
          :step="1"
          @update:model-value="bind.num('autoDetectTtlHours')"
        />
      </Row>
      <Options>
        <Btn @click="act('showGuards')">查看守护名单</Btn>
        <Btn @click="act('clearGuards')">清空守护名单</Btn>
      </Options>
    </Section>

    <!-- ⑧ 性能 -->
    <Section title="⑧ 性能">
      <Row label="单框 ROI 最大点数">
        <Number
          :model-value="config.maxPointsPerBox"
          :min="500"
          :max="60000"
          :step="500"
          @update:model-value="bind.num('maxPointsPerBox')"
        />
      </Row>
      <Row label="自动框选全帧点数上限">
        <Number
          :model-value="config.detectMaxPoints"
          :min="5000"
          :max="200000"
          :step="5000"
          @update:model-value="bind.num('detectMaxPoints')"
        />
      </Row>
      <Row
        label="ROI 体素 (m)"
        desc="后台一次建空间索引，多框共享"
      >
        <Number
          :model-value="config.roiVoxel"
          :min="0.1"
          :max="2"
          :step="0.1"
          @update:model-value="bind.num('roiVoxel')"
        />
      </Row>
      <Row label="帧点云 LRU 容量">
        <Number
          :model-value="config.frameCacheLimit"
          :min="2"
          :max="64"
          :step="1"
          @update:model-value="bind.num('frameCacheLimit')"
        />
      </Row>
      <Row label="贴合并发数 / 空闲时间片 (ms)">
        <div>
          <Number
            :model-value="config.frameConcurrency"
            :min="1"
            :max="8"
            :step="1"
            @update:model-value="bind.num('frameConcurrency')"
          />
          <Number
            :model-value="config.idleSliceMs"
            :min="0"
            :max="60"
            :step="2"
            @update:model-value="bind.num('idleSliceMs')"
          />
        </div>
      </Row>
      <Row label="Worker 超时 检测/贴合 (ms)">
        <div>
          <Number
            :model-value="config.workerTimeouts.detect"
            :min="1000"
            :step="500"
            @update:model-value="bind.nestedNum('workerTimeouts', 'detect')"
          />
          <Number
            :model-value="config.workerTimeouts.fit"
            :min="500"
            :step="500"
            @update:model-value="bind.nestedNum('workerTimeouts', 'fit')"
          />
        </div>
      </Row>
    </Section>

    <!-- ⑨ 界面 / 平台配置生效 -->
    <Section title="⑨ 界面 / 平台配置生效">
      <Row label="配色主题">
        <select
          :value="config.theme"
          @change="setTheme"
        >
          <option value="midnight">午夜蓝</option>
          <option value="sakura">樱色</option>
          <option value="mint">薄荷</option>
        </select>
      </Row>
      <SwitchRow
        :model-value="config.showAvatar"
        label="显示立绘"
        @update:model-value="bind.bool('showAvatar')"
      />
      <Row label="打字速度 (ms/字)">
        <Number
          :model-value="config.typeSpeed"
          :min="0"
          :max="120"
          :step="4"
          @update:model-value="bind.num('typeSpeed')"
        />
      </Row>
      <Row label="重新下发并刷新页面">
        <Btn @click="act('reloadConfig')">重载配置</Btn>
      </Row>
      <Note>
        刷新会重新加载页面，请先保存平台答案。插件不会替你提交答案，也不会修改框的类别 / 属性 / 来源字段。
      </Note>
    </Section>

    <Note>
      当前状态：{{ status.lastDetail }}<br />
      钩子：{{ status.hookReady ? '已就绪' : '等待注入' }} ·
      自动框选 {{ status.autoDetected ? '已执行' : '待执行' }} ·
      原生贴合 {{ status.nativeAutoFit ? 'ON' : 'OFF' }} ·
      增强贴合 {{ status.enhancedFit ? 'ON' : 'OFF' }} ·
      操作级别 {{ status.nativeOpsLevel || 'none' }}
    </Note>
  </div>
</template>