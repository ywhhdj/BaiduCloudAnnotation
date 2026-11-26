<script setup lang="ts">
withDefaults(defineProps<{
  label?: string;
  desc?: string;
  align?: 'center' | 'start'
}>(), {
  align: 'center'
})
</script>

<template>
  <div
    class="pc-row"
    :style="align === 'start' ? { alignItems: 'flex-start' } : undefined"
  >
    <div
      v-if="label || desc || $slots.label || $slots.desc"
      class="pc-label"
    >
      <slot name="label">{{ label }}</slot>
      <small v-if="desc || $slots.desc">
        <slot name="desc">{{ desc }}</slot>
      </small>
    </div>
    <slot />
  </div>
</template>