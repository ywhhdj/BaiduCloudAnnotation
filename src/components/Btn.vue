<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'primary' | 'ghost';
  on?: boolean
}>(), {
  variant: 'default',
  on: false
})
</script>

<template>
  <button
    type="button"
    class="pc-btn"
    :class="[variant !== 'default' && variant, on && 'on']"
  >
    <slot />
  </button>
</template>