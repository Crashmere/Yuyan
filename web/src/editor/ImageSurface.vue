<script setup lang="ts">
import { computed } from 'vue'
import { assetURL, type ImageSize } from '../shared/api'
import { displayVersions } from '../shared/images'
import { cropImageStyle, imageFrameStyle } from '../schema/imageGeometry'
// size: what the server stored for the image, which offers its display versions.
const props = defineProps<{ attrs: Record<string, any>; natural?: [number, number]; placement?: boolean; size?: ImageSize }>()
const style = computed(() => imageFrameStyle({ ...props.attrs, placement: props.placement ? props.attrs.placement : null }, props.natural))
const src = computed(() => assetURL(String(props.attrs.src ?? '')))
const versions = computed(() => displayVersions(src.value, props.size, null, true))
</script>
<template>
  <span data-image-frame :style="style" :data-frame="attrs.shadow === true ? 'shadow' : undefined">
    <img :loading="versions ? 'lazy' : undefined" :src="src" :srcset="versions?.srcset" :sizes="versions?.sizes" :alt="attrs.alt ?? ''" :style="cropImageStyle(attrs.crop)" draggable="false" @load="$emit('load', $event)" />
  </span>
</template>
