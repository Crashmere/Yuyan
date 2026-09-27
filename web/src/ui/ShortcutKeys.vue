<script setup lang="ts">
import { shortcutKeyGroups } from './shortcutKeys'
defineProps<{ combo: string }>()
</script>

<template>
  <span class="yy-shortcut-keys">
    <template v-for="(group, i) in shortcutKeyGroups(combo)" :key="i">
      <span v-if="i" class="yy-shortcut-or">或</span>
      <span class="yy-shortcut-chord" :aria-label="group.label">
        <kbd v-for="(key, j) in group.keys" :key="j" class="yy-keycap" :aria-label="key.label" :data-tip="key.label">
          <svg v-if="key.path" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="key.path" /></svg>
          <template v-else>{{ key.text }}</template>
        </kbd>
      </span>
    </template>
  </span>
</template>
