<script setup lang="ts">
defineProps<{
  label?: string
}>()
</script>

<template>
  <div class="pc-stat">
    <slot name="label">{{ label }}</slot>
    <slot />
  </div>
</template>