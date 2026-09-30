<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, PaintBucket, Palette } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { colorAttributes, colors, normalizeColor, type ColorKind } from '../schema/colors'

const props = defineProps<{ kind: ColorKind; value?: string | null; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ pick: [color: string | null] }>()
const open = ref(false)
const draft = ref('')
const label = computed(() => props.kind === 'text' ? '文字颜色' : '单元格底色')
const custom = computed(() => /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(draft.value.trim()) ? normalizeColor(draft.value) : null)
watch(open, value => { if (value) draft.value = props.value ?? '' })
function pick(color: string | null) { emit('pick', color); open.value = false }
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button type="button" :class="compact ? 'yy-bubble-btn' : 'yy-icon-btn'" :aria-label="label" :data-tip="label" :disabled="disabled" @mousedown.prevent>
        <Palette v-if="kind === 'text'" :size="17" /><PaintBucket v-else :size="17" />
      </button>
    </PopoverTrigger>
    <PopoverPortal :disabled="compact">
      <PopoverContent class="yy-color-picker yy-float" side="bottom" align="start" :side-offset="6" :collision-padding="8" :aria-label="label" @open-auto-focus.prevent @close-auto-focus.prevent>
        <div class="yy-color-heading">{{ label }}</div>
        <button type="button" class="yy-color-reset" @mousedown.prevent @click="pick(null)">恢复默认</button>
        <div class="yy-color-grid">
          <button v-for="c in colors" :key="c.label" type="button" class="yy-color-swatch" :aria-label="`${label}：${c.label}`" :data-tip="c.label" :aria-pressed="value === c[kind]"
            :style="colorAttributes(c[kind], kind).style" @mousedown.prevent @click="pick(c[kind])">
            <span v-if="kind === 'text'" aria-hidden="true">A</span>
            <Check v-if="value === c[kind]" class="yy-color-check" :size="11" aria-hidden="true" />
          </button>
        </div>
        <form class="yy-color-custom" @submit.prevent="custom && pick(custom)">
          <input v-model="draft" class="yy-input" placeholder="#RRGGBB" :aria-label="`自定义${label}`" maxlength="7" spellcheck="false" />
          <button type="submit" class="yy-btn small" :disabled="!custom">应用</button>
        </form>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
