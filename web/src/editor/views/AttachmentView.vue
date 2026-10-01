<script setup lang="ts">
import { computed, toRaw } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { Download, PencilLine } from 'lucide-vue-next'
import { attachmentHref, attachmentName, attachmentSize, attachmentType } from '../../schema/attachment'
import { base } from '../../shared/api'
import { prompt } from '../../ui/dialog'
import { closeHistory } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
const props = defineProps(nodeViewProps)
const href = computed(() => base.replace(/\/$/, '') + attachmentHref(props.node.attrs.src, props.node.attrs.name))
async function rename() {
  const original = toRaw(props.node), editor = props.editor
  let pos = props.getPos()
  if (pos === undefined) return
  // Opening a modal can recreate node views. Track the document position, not the old view.
  const map = ({ transaction }: { transaction: Transaction }) => {
    if (pos === undefined) return
    const result = transaction.mapping.mapResult(pos, 1)
    pos = result.deleted ? undefined : result.pos
  }
  editor.on('transaction', map)
  try {
    const name = await prompt({ title: '重命名附件', value: original.attrs.name, confirmText: '保存' })
    if (!name || editor.isDestroyed || pos === undefined || !editor.state.doc.nodeAt(pos)?.eq(original)) return
    editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...original.attrs, name: attachmentName(name) }))
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
  } finally { editor.off('transaction', map) }
}
</script>

<template>
  <NodeViewWrapper data-attachment contenteditable="false" :class="{ 'ProseMirror-selectednode': selected }">
    <div class="yy-attachment-card">
      <span class="yy-attachment-icon" aria-hidden="true">{{ attachmentType(node.attrs.name) }}</span>
      <span class="yy-attachment-info"><span class="yy-attachment-name">{{ node.attrs.name }}</span><span class="yy-attachment-size">{{ attachmentSize(node.attrs.size) }}</span></span>
      <button class="yy-icon-btn yy-attachment-action" type="button" data-tip="重命名附件" aria-label="重命名附件" @mousedown.prevent @click.stop="rename"><PencilLine :size="16" /></button>
      <a class="yy-icon-btn yy-attachment-action" :href="href" :download="node.attrs.name" data-tip="下载附件" aria-label="下载附件" @mousedown.stop @click.stop><Download :size="17" /></a>
    </div>
  </NodeViewWrapper>
</template>
