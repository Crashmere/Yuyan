<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { colorAttributes, gradientPaint } from '../schema/colors'

const props = defineProps<{ value: string | null; label: string; selected?: boolean; sample?: boolean; text?: boolean }>()
const emit = defineEmits<{ pick: [] }>()
const paint = computed(() => {
  if (!props.value) return undefined
  if (props.value.startsWith('gradient:')) return { background: gradientPaint(props.value.slice(9)) ?? undefined }
  const kind = props.text ? 'text' : 'background'
  const style = colorAttributes(props.value, kind).style ?? ''
  // Solid swatches show the same adaptive paint as their eventual text/background.
  return props.sample ? style : style.replace(/(^|;\s*)color:/g, '$1background-color:')
})
</script>

<template>
  <button type="button" class="yy-color-swatch" :class="{ selected, 'is-sample': sample, 'is-empty': !value && !sample }" :style="paint" :aria-label="label" :data-tip="label" :aria-pressed="!!selected" @mousedown.prevent @click="emit('pick')">
    <span v-if="sample" aria-hidden="true">A</span>
    <Check v-else-if="selected" :size="13" class="yy-color-check" aria-hidden="true" />
  </button>
</template>
