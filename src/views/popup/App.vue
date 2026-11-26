<script setup lang="ts">
import { computed } from 'vue'
import { useAssist } from '../../shared/useAssist'
import { useConfigBinder } from '../../shared/useConfigBinder'
import {
  Btn,
  Note,
  Options,
  Section,
  Stat,
  SwitchRow
} from '../../components/index'

const { status, config, patchConfig, action, openOptions } = useAssist()
const bind = useConfigBinder(patchConfig, () => config.value)
const frameCount = computed(() => status.value.frameCount || status.value.task?.frameCount || 0)
const act = (a: string) => action(a)
</script>

<template>
  <div
    class="pc-root pc-page"
    :class="`theme-${config.theme}`"
  >
    <div class="pc-title">点云贴边助手 ✧</div>
    <div class="pc-sub">点云初始化完毕自动圈好大部分目标 · 前辈只管审批和微调</div>

    <div
      class="pc-grid"
      style="margin-bottom: 14px"
    >
      <Stat label="当前帧"><b>{{ status.frameIndex + 1 }} / {{ frameCount }}</b></Stat>
      <Stat label="自动候选"><b>{{ status.candidateCount }}</b></Stat>
      <Stat label="待审批"><b>{{ status.pendingCount }}</b></Stat>
      <Stat label="已通过 / 守护"><b>{{ status.approvedCount }} / {{ status.guardCount }}</b></Stat>
    </div>

    <Note style="margin-bottom: 12px">
      URL {{ status.urlMatched ? '已命中规则' : '未命中' }} ·
      帧数来源 {{ status.frameCountSource || '等待解析' }} ·
      点云 {{ status.platformReady ? '已就绪' : status.readyDetail }} ·
      操作级别 {{ status.nativeOpsLevel || 'none' }}
    </Note>

    <Section title="快速开关">
      <SwitchRow
        :model-value="config.enabled"
        label="启用助手"
        desc="总开关，关闭后不做任何改写"
        @update:model-value="bind.bool('enabled')"
      />
      <SwitchRow
        :model-value="config.autoDetectOnOpen"
        label="打开页面自动框选"
        desc="点云加载后自动检测大部分目标并贴边生成候选"
        @update:model-value="bind.bool('autoDetectOnOpen')"
      />
      <SwitchRow
        :model-value="config.autoApproveHighConfidence"
        label="高置信度自动通过"
        desc="其余候选仍留在待审批列表里"
        @update:model-value="bind.bool('autoApproveHighConfidence')"
      />
      <SwitchRow
        :model-value="config.nativeAutoFit"
        label="平台原生自动贴合"
        desc="改写 toolConfig.autoFitBox，性能最优"
        @update:model-value="bind.bool('nativeAutoFit')"
      />
      <SwitchRow
        :model-value="config.enhancedFit"
        label="增强贴合（Worker）"
        desc="ROI + PCA/OBB，对已有框批量重算"
        @update:model-value="bind.bool('enhancedFit')"
      />
    </Section>

    <Options>
      <Btn
        variant="primary"
        @click="act('autoDetect')"
      >◎ 自动框选</Btn>
      <Btn
        variant="primary"
        @click="act('approveAll')"
      >✓ 全部通过</Btn>
      <Btn @click="act('showApprovals')">⌁ 审批清单</Btn>
      <Btn @click="act('fitCurrent')">✧ 贴边微调</Btn>
      <Btn @click="openOptions">⚙ 详细设置</Btn>
    </Options>

    <Note>
      最近台词：{{ status.lastDetail }}<br />
      钩子状态：<b>{{ status.hookReady ? '已就绪' : '等待注入' }}</b> ·
      自动框选：<b>{{ status.autoDetected ? '已执行' : '待执行' }}</b> ·
      原生贴合：<b>{{ status.nativeAutoFit ? 'ON' : 'OFF' }}</b>
    </Note>
  </div>
</template>