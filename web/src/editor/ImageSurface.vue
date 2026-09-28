<script setup lang="ts">
import { computed } from 'vue'
import { assetURL } from '../shared/api'
import { cropImageStyle, imageFrameStyle } from '../schema/imageGeometry'
const props = defineProps<{ attrs: Record<string, any>; natural?: [number, number]; placement?: boolean }>()
const style = computed(() => imageFrameStyle({ ...props.attrs, placement: props.placement ? props.attrs.placement : null }, props.natural))
</script>
<template>
  <span data-image-frame :style="style" :data-frame="attrs.shadow === true ? 'shadow' : undefined">
    <img :src="assetURL(String(attrs.src ?? ''))" :alt="attrs.alt ?? ''" :style="cropImageStyle(attrs.crop)" draggable="false" @load="$emit('load', $event)" />
  </span>
</template>
