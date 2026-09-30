<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { ChevronDown, Highlighter, PaintBucket } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { colorAttributes, textColorAttributes, textColorAttrs, gradientPaint } from '../schema/colors'
import { colorMemory, openColorPicker, rememberColor, type ColorChannel } from './colorPreferences'
import { quickBackground, quickText } from './colorPalette'
import ColorPalette from './ColorPalette.vue'
import ColorSwatch from './ColorSwatch.vue'

const props = defineProps<{ kind: ColorChannel | 'combined'; value?: string | null; background?: string | null; mixed?: boolean; backgroundMixed?: boolean; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ pick: [color: string | null]; background: [color: string | null]; repeat: []; reset: [] }>()
const id = useId()
const open = computed({ get: () => openColorPicker.value === id, set: value => { if (value) openColorPicker.value = id; else if (openColorPicker.value === id) openColorPicker.value = null } })
const panel = ref<InstanceType<typeof PopoverContent> | null>(null)
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
const channel = computed<ColorChannel>(() => props.kind === 'combined' ? 'text' : props.kind)
const label = computed(() => props.kind === 'combined' ? '文字与背景颜色' : props.kind === 'text' ? '文字颜色' : props.kind === 'highlight' ? '文字背景色' : '单元格底色')
const last = computed(() => colorMemory[channel.value].last)
const paint = computed(() => last.value?.startsWith('gradient:') ? gradientPaint(last.value.slice(9)) ?? undefined : last.value ? colorAttributes(last.value, channel.value === 'text' ? 'text' : 'background').style.split(';').at(-1)?.trim().replace(/^(?:background-)?color:\s*/, '') : 'var(--yy-text)')
const sample = computed(() => last.value ? textColorAttributes(textColorAttrs(last.value)).style : undefined)
const combinedBackground = computed(() => colorMemory.highlight.last ? colorAttributes(colorMemory.highlight.last, 'highlight').style : undefined)
function clearTimers() { clearTimeout(showTimer); clearTimeout(hideTimer) }
function hover(event: PointerEvent) {
  clearTimers()
  if (event.pointerType === 'mouse' && !props.disabled) showTimer = setTimeout(() => { open.value = true }, 90)
}
function keep() { clearTimers() }
function leave(event: PointerEvent) {
  clearTimers()
  if (event.pointerType !== 'mouse') return
  hideTimer = setTimeout(() => {
    const el = panel.value?.$el
    if (el instanceof HTMLElement && el.contains(document.activeElement)) return
    open.value = false
  }, 220)
}
function pick(color: string | null, custom = false, background = false) {
  rememberColor(background ? 'highlight' : channel.value, color, custom)
  if (background) emit('background', color)
  else emit('pick', color)
  open.value = false
}
function repeat() {
  open.value = false
  if (props.kind === 'combined') emit('repeat')
  else emit('pick', last.value)
}
function reset() { emit('reset'); open.value = false }
function escape(event: KeyboardEvent) {
  event.preventDefault()
  if (!event.isComposing && event.keyCode !== 229) open.value = false
}
watch(() => props.disabled, disabled => { if (disabled) open.value = false })
watch(open, () => clearTimers())
onBeforeUnmount(() => { clearTimers(); open.value = false })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <span class="yy-color-tool" :class="{ 'is-open': open, compact }" @pointerenter="keep" @pointerleave="leave">
      <button type="button" class="yy-color-apply" :disabled="disabled" :aria-label="`应用${label}`" :data-tip="`应用上次${label}`" @mousedown.prevent @click="repeat">
        <span v-if="kind === 'combined'" class="yy-color-combined-sample" :style="combinedBackground"><span :style="sample">A</span></span>
        <template v-else><span v-if="kind === 'text'" class="yy-color-letter">A</span><Highlighter v-else-if="kind === 'highlight'" :size="17" /><PaintBucket v-else :size="17" /><span class="yy-color-indicator" :style="{ background: paint }"></span></template>
      </button>
      <PopoverTrigger as-child>
        <button type="button" class="yy-color-arrow" :disabled="disabled" :aria-label="`${label}色板`" :data-tip="label" @pointerenter="hover" @mousedown.prevent><ChevronDown :size="13" :class="{ open }" /></button>
      </PopoverTrigger>
    </span>
    <PopoverPortal :disabled="compact">
      <PopoverContent ref="panel" class="yy-color-picker yy-float" :class="{ 'is-quick': kind === 'combined' }" side="bottom" align="start" :align-offset="-28" :side-offset="7" :collision-padding="8" :aria-label="label" @open-auto-focus.prevent @close-auto-focus.prevent @pointerenter="keep" @pointerleave="leave" @escape-key-down="escape">
        <template v-if="kind === 'combined'">
          <div class="yy-color-heading">字体颜色</div>
          <div class="yy-color-grid quick">
            <ColorSwatch v-for="c in quickText" :key="c ?? 'default'" :value="c" sample text :label="c ? `文字颜色 ${c.toUpperCase()}` : '默认文字颜色'" :selected="!mixed && (value ?? null) === c" @pick="pick(c)" />
          </div>
          <div class="yy-color-heading">背景颜色</div>
          <div class="yy-color-grid quick">
            <ColorSwatch v-for="c in quickBackground" :key="c ?? 'default'" :value="c" :label="c ? `文字背景色 ${c.toUpperCase()}` : '无文字背景色'" :selected="!backgroundMixed && (background ?? null) === c" @pick="pick(c, false, true)" />
          </div>
          <button type="button" class="yy-color-reset" @mousedown.prevent @click="reset">恢复默认</button>
        </template>
        <ColorPalette v-else :channel="channel" :value="value" :mixed="mixed" @pick="pick" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
