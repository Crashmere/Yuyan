<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { clamp, cropRect, round, type ImageRect } from '../schema/imageGeometry'
import { assetURL } from '../shared/api'
const props = defineProps<{ modelValue: ImageRect; src: string; ratio: number; lock?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [ImageRect] }>()
const box = computed(() => ({ left: `${props.modelValue.x * 100}%`, top: `${props.modelValue.y * 100}%`, width: `${props.modelValue.width * 100}%`, height: `${props.modelValue.height * 100}%` }))
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
let cleanup: (() => void) | undefined
onBeforeUnmount(() => cleanup?.())
function start(e: PointerEvent, handle: string) {
  if (e.button !== 0) return
  e.preventDefault(); e.stopPropagation(); cleanup?.()
  const target = e.currentTarget as HTMLElement, area = target.closest('.yy-crop-area')!.getBoundingClientRect()
  const initial = { ...props.modelValue }, x = e.clientX, y = e.clientY
  target.setPointerCapture(e.pointerId)
  const move = (event: PointerEvent) => {
    const dx = (event.clientX - x) / area.width, dy = (event.clientY - y) / area.height
    let left = initial.x, top = initial.y, right = left + initial.width, bottom = top + initial.height
    if (handle === 'move') {
      left = clamp(left + dx, 0, 1 - initial.width); top = clamp(top + dy, 0, 1 - initial.height)
      right = left + initial.width; bottom = top + initial.height
    } else {
      if (handle.includes('w')) left = clamp(left + dx, 0, right - 0.01)
      if (handle.includes('e')) right = clamp(right + dx, left + 0.01, 1)
      if (handle.includes('n')) top = clamp(top + dy, 0, bottom - 0.01)
      if (handle.includes('s')) bottom = clamp(bottom + dy, top + 0.01, 1)
      if (props.lock) {
        const ratio = props.lock / props.ratio
        let w = right - left, h = bottom - top
        if (handle === 'n' || handle === 's') w = Math.min(h * ratio, 1 - left)
        else h = Math.min(w / ratio, handle.includes('n') ? bottom : 1 - top)
        w = Math.min(w, h * ratio); h = w / ratio
        if (handle.includes('w')) left = right - w; else right = left + w
        if (handle.includes('n')) top = bottom - h; else bottom = top + h
      }
    }
    emit('update:modelValue', cropRect({ x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }))
  }
  const end = (event: PointerEvent) => { if (event.type === 'pointercancel') emit('update:modelValue', initial); cleanup?.() }
  cleanup = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); cleanup = undefined }
  target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
}
</script>
<template>
  <div class="yy-crop-area" :style="{ width: `${Math.min(640, ratio * 380)}px`, aspectRatio: String(ratio) }">
    <img :src="assetURL(src)" alt="裁切原图" draggable="false" />
    <div class="yy-crop-box" :style="box" @pointerdown="start($event, 'move')">
      <div class="yy-crop-thirds"></div>
      <span v-for="handle in handles" :key="handle" class="yy-crop-handle" :class="handle" :data-handle="handle" @pointerdown.stop="start($event, handle)"></span>
    </div>
  </div>
</template>
