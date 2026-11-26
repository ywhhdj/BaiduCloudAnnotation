<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAssist, useTypewriter } from '../../shared/useAssist'
import { Btn, Options } from '../../components/index'

const { status, config, action, openOptions, patchConfig, UI_ACTION } = useAssist()
const text = computed(() => status.value.lastDetail || '')
const speed = computed(() => config.value.typeSpeed || 24)
const typed = useTypewriter(text, speed)
const typing = computed(() => typed.value.length < text.value.length)
const frameCount = computed(() => status.value.frameCount || status.value.task?.frameCount || 0)

const dx = ref(0), dy = ref(0)
const floatStyle = computed(() => ({
  transform: `translate(${dx.value}px, ${dy.value}px)`
}))

function startDrag(e: PointerEvent) {
  const sx = e.clientX, sy = e.clientY, ox = dx.value, oy = dy.value
  const move = (ev: PointerEvent) => {
    dx.value = Math.max(-320, Math.min(320, ox + ev.clientX - sx))
    dy.value = Math.max(-300, Math.min(160, oy + ev.clientY - sy))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const act = (a: string) => action(a)
const collapse = () => {
  patchConfig({ collapsed: true });
  action(UI_ACTION.collapse, true)
}
const expand = () => {
  patchConfig({ collapsed: false });
  action(UI_ACTION.collapse, false)
}
</script>

<template>
  <div
    class="pc-root pc-float"
    :class="`theme-${config.theme}`"
    :style="floatStyle"
  >
    <div
      v-if="!config.collapsed"
      class="pc-card"
    >
      <div
        v-if="config.showAvatar"
        class="pc-avatar"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M30 30 Q50 17 70 30"
            stroke="#2b2140"
            stroke-width="4"
            fill="none"
            stroke-linecap="round"
          />
          <ellipse
            cx="35"
            cy="52"
            rx="6"
            ry="9"
            fill="#2b2140"
          />
          <ellipse
            cx="65"
            cy="52"
            rx="6"
            ry="9"
            fill="#2b2140"
          />
          <circle
            cx="37"
            cy="49"
            r="2"
            fill="#fff"
          />
          <circle
            cx="67"
            cy="49"
            r="2"
            fill="#fff"
          />
          <circle
            cx="24"
            cy="63"
            r="6"
            fill="#ff8fb6"
            opacity=".55"
          />
          <circle
            cx="76"
            cy="63"
            r="6"
            fill="#ff8fb6"
            opacity=".55"
          />
          <path
            d="M42 70 Q50 77 58 70"
            stroke="#2b2140"
            stroke-width="3"
            fill="none"
            stroke-linecap="round"
          />
          <path
            d="M46 22 Q50 12 54 22"
            stroke="#7ce7ff"
            stroke-width="3"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div
        class="pc-nameplate"
        title="按住可拖动"
        @pointerdown="startDrag"
      >小点云 · Point-chan</div>

      <div class="pc-dialog">
        <span>{{ typed }}</span><span
          v-if="typing"
          class="pc-caret"
        ></span>
      </div>

      <div class="pc-status">
        <span>第 <b>{{ status.frameIndex + 1 }}</b>/{{ frameCount }} 帧</span>
        <span>候选 <b>{{ status.candidateCount }}</b></span>
        <span>待审 <b>{{ status.pendingCount }}</b></span>
        <span>已批 <b>{{ status.approvedCount }}</b></span>
        <span>守护 <b>{{ status.guardCount }}</b></span>
        <span v-if="status.workerBusy"><b>计算中…</b></span>
      </div>

      <Options style="margin-bottom: 7px">
        <Btn
          variant="primary"
          @click="act('autoDetect')"
        >◎ 自动框选</Btn>
        <Btn @click="act('autoDetectAllFrames')">◎ 多帧框选</Btn>
        <Btn @click="act('fitCurrent')">✧ 贴边微调</Btn>
        <Btn @click="act('fitAllFrames')">⧉ 多帧贴边</Btn>
      </Options>
      <Options>
        <Btn
          variant="primary"
          @click="act('approveAll')"
        >✓ 全部通过</Btn>
        <Btn @click="act('approveHigh')">✓ 高置信通过</Btn>
        <Btn @click="act('rejectAll')">✕ 全部拒绝</Btn>
        <Btn @click="act('showApprovals')">⌁ 审批清单</Btn>
        <Btn @click="openOptions">⚙ 设置</Btn>
        <Btn
          variant="ghost"
          @click="collapse"
        >▽ 隐身</Btn>
      </Options>
    </div>

    <button
      v-else
      class="pc-ball"
      title="点我展开"
      @click="expand"
    >
      <span class="pc-dot"></span>点云
    </button>
  </div>
</template>