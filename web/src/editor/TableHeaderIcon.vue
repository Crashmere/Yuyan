<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 17 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 4h16v4H4z" fill="currentColor" fill-opacity=".24" stroke="none" />
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 8h16M4 12h16M4 16h16M9.33 4v16M14.67 4v16" />
  </svg>
</template>
