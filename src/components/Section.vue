<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="pc-section">
    <h3 v-if="title || $slots.title">
      <slot name="title">{{ title }}</slot>
    </h3>
    <slot />
  </div>
</template>