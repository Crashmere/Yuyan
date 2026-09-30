<script setup lang="ts">
import { onMounted, ref } from 'vue'
const props = defineProps<{ value?: string | null }>()
const emit = defineEmits<{ save: [value: string | null]; cancel: [] }>()
const text = ref(props.value ?? '')
const input = ref<HTMLTextAreaElement | null>(null)
onMounted(() => input.value?.focus())
</script>

<template>
  <form class="yy-image-caption-form" @submit.prevent="emit('save', text.trim() || null)" @keydown.esc.stop.prevent="!$event.isComposing && emit('cancel')">
    <textarea ref="input" v-model="text" class="yy-input" rows="3" aria-label="图片说明" placeholder="显示在图片下方的说明，可换行" />
    <div><button type="button" class="yy-btn small" @click="emit('cancel')">取消</button><button type="submit" class="yy-btn small primary">确定</button></div>
  </form>
</template>
