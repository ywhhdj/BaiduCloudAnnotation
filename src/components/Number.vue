<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: number
    label?: string
    min?: number
    max?: number
    step?: number
    width?: string | number
  }>(),
  { step: 1 }
)
const emit = defineEmits<{
  'update:modelValue': [v: number]
}>()

function onInput(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(n)) emit('update:modelValue', n)
}
</script>

<template>
  <label class="pc-num">
    <span v-if="label">{{ label }}</span>
    <input
      type="number"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :style="width ? { width: typeof width === 'number' ? `${width}px` : width } : undefined"
      @input="onInput"
    />
  </label>
</template>