<script setup lang="ts">
// An icon-only button; label is both its accessible name and its tooltip (ui/tooltip.ts).
withDefaults(defineProps<{ label: string; small?: boolean; active?: boolean; tooltip?: boolean }>(), { tooltip: true })
</script>

<template>
  <button type="button" class="yy-icon-btn" :class="{ small, active }" :aria-label="label" :data-tip="tooltip ? label : undefined">
    <slot />
  </button>
</template>
