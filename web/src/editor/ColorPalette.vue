<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { normalizeColor, textGradients } from '../schema/colors'
import { colorMemory, type ColorChannel } from './colorPreferences'
import { paletteRows } from './colorPalette'
import ColorSwatch from './ColorSwatch.vue'

const props = defineProps<{ channel: ColorChannel; value?: string | null; mixed?: boolean }>()
const emit = defineEmits<{ pick: [value: string | null, custom?: boolean] }>()
const label = computed(() => props.channel === 'text' ? '文字颜色' : props.channel === 'highlight' ? '文字背景色' : '单元格底色')
const more = ref(false)
const draft = ref(normalizeColor(props.value) ?? '#3264c8')
const custom = computed(() => /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(draft.value.trim()) ? normalizeColor(draft.value) : null)
const recent = computed(() => colorMemory[props.channel].recent)
const selected = (value: string | null) => !props.mixed && (props.value ?? null) === value
</script>

<template>
  <div class="yy-color-full">
    <button type="button" class="yy-color-default" @mousedown.prevent @click="emit('pick', null)">
      <span class="yy-color-default-chip" :class="{ 'is-empty': channel !== 'text' }"></span>{{ channel === 'text' ? '默认' : '无填充色' }}
      <span v-if="selected(null)" class="yy-color-default-check">✓</span>
    </button>
    <div class="yy-color-matrix" :aria-label="`${label}色板`">
      <div v-for="(row, index) in paletteRows" :key="index" class="yy-color-grid full" :class="{ 'hue-row': index === 1 }">
        <ColorSwatch v-for="c in row" :key="c" :value="c" :text="channel === 'text'" :label="`${label} ${c.toUpperCase()}`" :selected="selected(c)" @pick="emit('pick', c)" />
      </div>
    </div>
    <template v-if="channel === 'text'">
      <div class="yy-color-heading">渐变色</div>
      <div class="yy-color-gradients">
        <ColorSwatch v-for="g in textGradients" :key="g.id" :value="`gradient:${g.id}`" :label="g.label" :selected="selected(`gradient:${g.id}`)" @pick="emit('pick', `gradient:${g.id}`)" />
      </div>
    </template>
    <div class="yy-color-heading">最近使用自定义颜色</div>
    <div v-if="recent.length" class="yy-color-grid full yy-color-recent">
      <ColorSwatch v-for="c in recent" :key="c" :value="c" :text="channel === 'text'" :label="`最近使用 ${c.toUpperCase()}`" :selected="selected(c)" @pick="emit('pick', c, true)" />
    </div>
    <div v-else class="yy-color-empty">暂无</div>
    <button type="button" class="yy-color-more" :aria-expanded="more" @mousedown.prevent @click="more = !more"><span class="yy-color-spectrum"></span>更多颜色<ChevronDown :size="15" :class="{ open: more }" /></button>
    <form v-if="more" class="yy-color-custom" @submit.prevent="custom && emit('pick', custom, true)">
      <input class="yy-color-native" type="color" :value="custom ?? '#3264c8'" aria-label="颜色选择器" @input="draft = ($event.target as HTMLInputElement).value" />
      <input v-model="draft" class="yy-input" placeholder="#RRGGBB" :aria-label="`自定义${label}`" maxlength="7" spellcheck="false" />
      <button type="submit" class="yy-btn small" :disabled="!custom">应用</button>
    </form>
  </div>
</template>
