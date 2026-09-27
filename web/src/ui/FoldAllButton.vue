<script setup lang="ts">
import IconButton from './IconButton.vue'

defineProps<{ expanded: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <IconButton small :label="expanded ? '全部折叠' : '全部展开'" @click="$emit('click')">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path :d="expanded ? 'M11 5h9M11 12h9M11 19h9' : 'M4 5h16M11 12h9M4 19h16'" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path :d="expanded ? 'm2 10 3.5 4 3.5-4Z' : 'm3 8 4 4-4 4Z'" fill="currentColor" />
    </svg>
  </IconButton>
</template>
