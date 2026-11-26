<script setup lang="ts">
defineProps<{
  modelValue?: boolean;
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked)
}
</script>

<template>
  <input
    class="pc-switch"
    type="checkbox"
    :checked="modelValue"
    :disabled="disabled"
    @change="onChange"
  />
</template>