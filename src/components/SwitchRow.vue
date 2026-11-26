<script setup lang="ts">
import Row from './Row.vue'
import Switch from './Switch.vue'

defineProps<{
  modelValue: boolean;
  label?: string;
  desc?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()
</script>

<template>
  <Row
    :label="label"
    :desc="desc"
  >
    <Switch
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </Row>
</template>