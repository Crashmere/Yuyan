<script setup lang="ts">
import { computed, ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { cropRect, imageDimensions, splitRects, storedCrop, type ImageRect } from '../schema/imageGeometry'
import { assetURL } from '../shared/api'
import { toast } from '../ui/toast'
import { useEditorContext } from './context'
import { applyImageParameters, boardAt, cropImages, imageAt, scopeImages, sectionAt, sourceAttrs, splitImage, type ImageEditMode, type ImageParameter, type ImageScope } from './imageOperations'
import CropControl from './CropControl.vue'
import ImageSurface from './ImageSurface.vue'
const props = defineProps<{ mode: ImageEditMode; positions: number[] }>()
const emit = defineEmits<{ close: [] }>()
const { editor } = useEditorContext()
const e = editor.value!, originalDoc = e.state.doc
const targets = props.positions.flatMap((pos) => { const t = imageAt(e, pos); return t ? [t] : [] })
const reference = ref(targets[0]?.pos ?? -1)
const source = computed(() => targets.find((t) => t.pos === reference.value)!)
const attrs = computed(() => source.value ? sourceAttrs(e, source.value) : {})
const dimensions = computed(() => imageDimensions(attrs.value))
const crop = ref<ImageRect>(cropRect(attrs.value.crop)), lock = ref<number | null>(null)
const axis = ref<'horizontal' | 'vertical'>('vertical'), parts = ref(2), first = ref(50)
const scope = ref<ImageScope>(targets.length > 1 ? 'selection' : boardAt(e, reference.value) ? 'board' : 'document')
const params = ref<ImageParameter[]>(['size', 'align', ...(attrs.value.crop ? ['crop' as const] : [])])
const parameterOptions = [{ key: 'size', label: '大小' }, { key: 'align', label: '对齐' }, { key: 'crop', label: '裁切' }, { key: 'shadow', label: '阴影边框' }] as const
const affected = computed(() => scopeImages(e, scope.value, props.positions, reference.value))
const section = computed(() => sectionAt(e, reference.value).title)
const inBoard = computed(() => !!boardAt(e, reference.value))
const title = computed(() => props.mode === 'apply' ? '批量应用图片参数' : props.mode === 'split' ? '切分图片' : `裁切${targets.length > 1 ? ` ${targets.length} 张图片` : '图片'}`)
const splits = computed(() => splitRects(null, axis.value, parts.value, first.value / 100))
function ratio(value: number | null) {
  lock.value = value
  if (!value) return
  const normalized = value / (dimensions.value.sourceWidth / dimensions.value.sourceHeight)
  const width = Math.min(1, normalized), height = Math.min(1, 1 / normalized)
  crop.value = { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
}
function apply() {
  if (e.isDestroyed || e.state.doc !== originalDoc) { toast('文档已变化，请重新打开图片工具后重试', 'info'); emit('close'); return }
  if (!source.value) return
  if (props.mode === 'crop') { cropImages(e, targets, storedCrop(crop.value)); toast(`已裁切 ${targets.length} 张图片`, 'success') }
  else if (props.mode === 'split') { splitImage(e, source.value, axis.value, parts.value, first.value / 100); toast(`已切分为 ${parts.value} 张图片`, 'success') }
  else { const count = applyImageParameters(e, source.value, affected.value, params.value); toast(count ? `已更新 ${count} 张图片` : '所选参数已一致', count ? 'success' : 'info') }
  emit('close')
}
function restoreFocus(event: Event) {
  event.preventDefault()
  requestAnimationFrame(() => { if (!e.isDestroyed) e.commands.focus(undefined, { scrollIntoView: false }) })
}
</script>
<template>
  <DialogRoot :open="true" @update:open="(open) => !open && emit('close')">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-image-dialog" :aria-describedby="undefined" @close-auto-focus="restoreFocus">
        <DialogTitle class="yy-dialog-title">{{ title }}</DialogTitle>
        <template v-if="mode === 'crop'">
          <div class="yy-image-dialog-options">
            <label>比例 <select class="yy-input" aria-label="裁切比例" :value="lock ?? ''" @change="ratio(Number(($event.target as HTMLSelectElement).value) || null)"><option value="">自由</option><option :value="1">1:1</option><option :value="4 / 3">4:3</option><option :value="16 / 9">16:9</option><option :value="3 / 4">3:4</option></select></label>
            <button type="button" class="yy-btn small" @click="crop = cropRect(null); lock = null">重置裁切</button>
          </div>
          <div class="yy-image-preview"><CropControl v-model="crop" :src="String(attrs.src ?? '')" :ratio="dimensions.sourceWidth / dimensions.sourceHeight" :lock="lock" /></div>
          <div class="yy-crop-values">
            <label v-for="key in ['x', 'y', 'width', 'height'] as const" :key="key">{{ { x: '左侧', y: '顶部', width: '宽度', height: '高度' }[key] }} %<input type="number" class="yy-input" :aria-label="`裁切${key}`" :min="key === 'width' || key === 'height' ? 0.1 : 0" max="100" step="0.1" :value="Math.round(crop[key] * 1000) / 10" @change="crop = cropRect({ ...crop, [key]: Number(($event.target as HTMLInputElement).value) / 100 }); lock = null" /></label>
          </div>
          <p class="yy-dialog-message">拖动边框调整范围，拖动框内移动。{{ targets.length > 1 ? '按同一比例裁切所选图片。' : '' }}原图保留，可随时重调。</p>
        </template>
        <template v-else-if="mode === 'split'">
          <div class="yy-image-dialog-options">
            <label>方向 <select v-model="axis" class="yy-input" aria-label="切分方向"><option value="vertical">左右切分</option><option value="horizontal">上下切分</option></select></label>
            <label>份数 <input v-model.number="parts" type="number" class="yy-input" aria-label="切分份数" min="2" max="8" @change="parts = Math.max(2, Math.min(8, Math.round(parts || 2)))" /></label>
            <label v-if="parts === 2">第一份 {{ first }}% <input v-model.number="first" type="range" min="5" max="95" aria-label="切分位置" /></label>
          </div>
          <div class="yy-image-preview"><div class="yy-split-preview" :style="{ width: `${Math.min(640, dimensions.ratio * 380)}px`, aspectRatio: String(dimensions.ratio) }">
            <ImageSurface :attrs="{ ...attrs, width: 640, height: null }" />
            <div v-for="(piece, i) in splits" :key="i" class="yy-split-piece" :style="{ left: `${piece.x * 100}%`, top: `${piece.y * 100}%`, width: `${piece.width * 100}%`, height: `${piece.height * 100}%` }"><span>{{ i + 1 }}</span></div>
          </div></div>
          <p class="yy-dialog-message">把当前可见区域切成互补的 {{ parts }} 份，每份都可独立调整，原图保留。</p>
        </template>
        <template v-else>
          <label v-if="targets.length > 1" class="yy-image-source">以哪张为准 <select v-model="reference" class="yy-input" aria-label="参数来源"><option v-for="(t, i) in targets" :key="t.pos" :value="t.pos">第 {{ i + 1 }} 张{{ t.node.attrs.alt ? ` · ${t.node.attrs.alt}` : '' }}</option></select></label>
          <div class="yy-image-source-preview"><img :src="assetURL(String(attrs.src ?? ''))" alt="参数来源图片" /><span>{{ attrs.width ? `${attrs.width} px` : '原始尺寸' }} · {{ attrs.crop ? '已裁切' : '未裁切' }}</span></div>
          <fieldset class="yy-image-options"><legend>应用哪些参数</legend><label v-for="p in parameterOptions" :key="p.key"><input v-model="params" type="checkbox" :value="p.key" />{{ p.label }}</label></fieldset>
          <fieldset class="yy-image-scopes"><legend>应用范围</legend>
            <label><input v-model="scope" type="radio" value="selection" />当前选中的图片 <small>{{ targets.length }} 张</small></label>
            <label><input v-model="scope" type="radio" value="section" />当前这一节 <small>{{ section }}，含子节</small></label>
            <label v-if="inBoard"><input v-model="scope" type="radio" value="board" />当前组合</label>
            <label><input v-model="scope" type="radio" value="document" />全文图片 <small>包含组合中的图片</small></label>
          </fieldset>
          <p class="yy-dialog-message">范围内共 {{ affected.length }} 张图片。{{ params.includes('crop') ? '裁切按原图比例应用。' : '' }}{{ params.includes('align') ? '组合内的位置由画板排列控制。' : '' }}</p>
        </template>
        <div class="yy-dialog-actions"><button type="button" class="yy-btn" @click="emit('close')">取消</button><button type="button" class="yy-btn primary" :disabled="!targets.length || (mode === 'apply' && (!params.length || !affected.length))" @click="apply">{{ mode === 'crop' ? '应用裁切' : mode === 'split' ? '切分' : '应用参数' }}</button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
