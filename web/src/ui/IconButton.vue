<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

// An icon-only button; label is both its accessible name and its tooltip. Attributes and
// listeners go to the button, not to the tooltip wrapper.
defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ label: string; small?: boolean; active?: boolean; tooltip?: boolean }>(), { tooltip: true })
</script>

<template>
  <TooltipRoot :disabled="!tooltip">
    <TooltipTrigger as-child>
      <button type="button" class="yy-icon-btn" :class="{ small, active }" :aria-label="label" v-bind="$attrs">
        <slot />
      </button>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="yy-tooltip" :side-offset="6">{{ label }}</TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
