<script setup lang="ts">
import { computed } from 'vue';
import { useAssist } from '../shared/useAssist';

const { status, config, patchConfig, action, openOptions, UI_ACTION } = useAssist();
const frameCount = computed(() => status.value.task?.frameCount || 5);
const setBool = (key: 'enabled' | 'nativeAutoFit' | 'enhancedFit' | 'multiFrameBatch' | 'autoDetectOnOpen' | 'autoApproveHighConfidence', e: Event) =>
  patchConfig({ [key]: (e.target as HTMLInputElement).checked });
const act = (a: string) => action(a);
</script>

<template>
  <div class="pc-root pc-page" :class="`theme-${config.theme}`">
    <div class="pc-title">点云贴边助手 ✧</div>
    <div class="pc-sub">打开即自动圈好大部分目标 · 前辈只管审批和微调</div>

    <div class="pc-grid" style="margin-bottom: 14px">
      <div class="pc-stat">当前帧<b>{{ status.frameIndex + 1 }} / {{ frameCount }}</b></div>
      <div class="pc-stat">自动候选<b>{{ status.candidateCount }}</b></div>
      <div class="pc-stat">待审批<b>{{ status.pendingCount }}</b></div>
      <div class="pc-stat">已通过 / 守护<b>{{ status.approvedCount }} / {{ status.guardCount }}</b></div>
    </div>

    <div class="pc-section">
      <h3>快速开关</h3>
      <div class="pc-row">
        <div class="pc-label">启用助手<small>总开关，关闭后不做任何改写</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.enabled" @change="setBool('enabled', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">打开页面自动框选<small>点云加载后自动检测大部分目标并贴边生成候选</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.autoDetectOnOpen" @change="setBool('autoDetectOnOpen', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">高置信度自动通过<small>其余候选仍留在待审批列表里</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.autoApproveHighConfidence" @change="setBool('autoApproveHighConfidence', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">平台原生自动贴合<small>改写 toolConfig.autoFitBox，性能最优</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.nativeAutoFit" @change="setBool('nativeAutoFit', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">增强贴合（Worker）<small>ROI + PCA/OBB，对已有框批量重算</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.enhancedFit" @change="setBool('enhancedFit', $event)" />
      </div>
    </div>

    <div class="pc-options">
      <button class="pc-btn primary" @click="act('autoDetect')">◎ 自动框选</button>
      <button class="pc-btn primary" @click="act('approveAll')">✓ 全部通过</button>
      <button class="pc-btn" @click="act('showApprovals')">⌁ 审批清单</button>
      <button class="pc-btn" @click="act('fitCurrent')">✧ 贴边微调</button>
      <button class="pc-btn" @click="openOptions">⚙ 详细设置</button>
    </div>

    <div class="pc-note">
      最近台词：{{ status.lastDetail }}<br />
      钩子状态：<b>{{ status.hookReady ? '已就绪' : '等待注入' }}</b> ·
      自动框选：<b>{{ status.autoDetected ? '已执行' : '待执行' }}</b> ·
      原生贴合：<b>{{ status.nativeAutoFit ? 'ON' : 'OFF' }}</b>
    </div>
  </div>
</template>
