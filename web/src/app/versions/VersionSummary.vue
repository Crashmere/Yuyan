<script setup lang="ts">
import { ref } from 'vue'
import type { ChangeSummary } from '../../shared/api'

defineProps<{ summary: ChangeSummary }>()
const expanded = ref(false)
</script>

<template>
  <div class="yy-version-summary">
    <div class="yy-version-labels"><span v-for="label in summary.labels" :key="label" class="yy-tag">{{ label }}</span></div>
    <p v-if="summary.sections.length" class="yy-version-sections">
      <span>涉及：</span>{{ (expanded ? summary.sections : summary.sections.slice(0, 3)).join('；') }}
      <button v-if="summary.sections.length > 3" type="button" class="yy-btn small" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起' : `另 ${summary.sections.length - 3} 处` }}</button>
    </p>
  </div>
</template>
