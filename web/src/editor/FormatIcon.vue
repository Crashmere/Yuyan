<script setup lang="ts">
withDefaults(defineProps<{ kind: 'brush' | 'clear'; size?: number }>(), { size: 17 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="kind === 'brush'">
      <rect x="2.5" y="2.5" width="16" height="6.5" rx="2" />
      <path d="M18.5 5.5H20a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-6.5a2 2 0 0 0-2 2V16" />
      <rect x="9.5" y="16" width="4" height="6" rx="1.5" />
    </template>
    <template v-else>
      <path d="m3.5 12.2 8.2-8.7a2 2 0 0 1 2.9 0l5.9 6.2a2 2 0 0 1 0 2.8L13 20H8.5l-5-5a2 2 0 0 1 0-2.8Z" />
      <path d="m7.5 8 9 9M8.5 20H21" />
    </template>
  </svg>
</template>
