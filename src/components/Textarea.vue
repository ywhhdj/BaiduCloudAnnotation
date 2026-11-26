<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: string;
  rows?: number;
  placeholder?: string
}>(), {
  rows: 5
})
const emit = defineEmits<{
  'update:modelValue': [v: string]
}>()
</script>

<template>
  <textarea
    class="pc-textarea"
    :rows="rows"
    :value="modelValue"
    :placeholder="placeholder"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>