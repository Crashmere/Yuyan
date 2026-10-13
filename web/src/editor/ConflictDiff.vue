<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import type { JSONContent } from '@tiptap/core'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { api, errorMessage, type Doc } from '../shared/api'
import { formatTime } from '../app/time'
import DiffBody from '../app/versions/DiffBody.vue'
import type { Comparison } from '../app/versions/compare'

// After a save conflict: what this page's content would change in the latest saved version, before
// choosing between them. Overwriting from here starts from the version that was compared, so a
// newer save made meanwhile is reported as another conflict.
const props = defineProps<{ docId: number; mine: { title: string; content: JSONContent } }>()
const emit = defineEmits<{ close: []; reload: []; overwrite: [revision: number] }>()

const result = shallowRef<(Comparison & { from: string; to: string; revision: number }) | null>(null)
const failure = ref('')

onMounted(async () => {
  try {
    const [{ compareVersions }, latest] = await Promise.all([import('../app/versions/compare'), api<Doc>(`docs/${props.docId}`)])
    result.value = { from: `已保存的最新版本 r${latest.revision}（${formatTime(latest.updatedAt)}）`, to: '这里的内容', revision: latest.revision, ...compareVersions(latest, props.mine) }
  } catch (e) {
    failure.value = errorMessage(e)
  }
})
</script>

<template>
  <DialogRoot :open="true" @update:open="(open) => !open && emit('close')">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-conflict-dialog" :aria-describedby="undefined">
        <DialogTitle class="yy-dialog-title">与已保存的最新版本对比</DialogTitle>
        <div class="yy-conflict-diff">
          <p v-if="failure" class="yy-page-error">加载失败：{{ failure }}</p>
          <DiffBody v-else-if="result" :result="result" />
          <p v-else class="yy-dialog-message">正在比较…</p>
        </div>
        <div class="yy-dialog-actions">
          <template v-if="result">
            <button type="button" class="yy-btn" @click="emit('reload')">载入最新版本（放弃这里的修改）</button>
            <button type="button" class="yy-btn" @click="emit('overwrite', result.revision)">用这里的内容覆盖</button>
          </template>
          <button type="button" class="yy-btn primary" @click="emit('close')">关闭</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
