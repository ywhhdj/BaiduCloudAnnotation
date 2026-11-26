<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    precision?: number
  }>(),
  {
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2
  }
)
const emit = defineEmits<{
  'update:modelValue': [v: number]
}>()
const display = computed(() => props.modelValue.toFixed(props.precision))
</script>

<template>
  <div class="pc-range">
    <input
      type="range"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    />
    <b>{{ display }}</b>
  </div>
</template>