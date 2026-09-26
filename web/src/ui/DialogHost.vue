<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { closeDialog, currentDialog } from './dialog'

const value = ref('')
const input = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const request = computed(() => currentDialog.value)

watch(request, async (r) => {
  if (r?.kind !== 'prompt') return
  value.value = r.options.value ?? ''
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

const canSubmit = computed(() => request.value?.kind !== 'prompt' || request.value.options.allowEmpty || value.value.trim() !== '')

function finish(ok: boolean) {
  const r = request.value
  if (!r) return
  if (r.kind === 'confirm') r.resolve(ok)
  else r.resolve(ok ? value.value.trim() : null)
  closeDialog()
}

function submit() {
  if (canSubmit.value) finish(true)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing && (request.value?.kind === 'confirm' || !(e.target instanceof HTMLTextAreaElement) || e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <DialogRoot :open="!!request" @update:open="(open) => !open && finish(false)">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent v-if="request" class="yy-dialog" :aria-describedby="undefined" @keydown="onKeydown">
        <DialogTitle class="yy-dialog-title">{{ request.options.title }}</DialogTitle>
        <template v-if="request.kind === 'confirm'">
          <DialogDescription v-if="request.options.message" class="yy-dialog-message">{{ request.options.message }}</DialogDescription>
        </template>
        <template v-else>
          <label v-if="request.options.label" class="yy-dialog-label" for="yy-dialog-input">{{ request.options.label }}</label>
          <textarea
            v-if="request.options.multiline"
            id="yy-dialog-input"
            ref="input"
            v-model="value"
            class="yy-input yy-textarea"
            rows="4"
            :placeholder="request.options.placeholder"
          ></textarea>
          <input v-else id="yy-dialog-input" ref="input" v-model="value" class="yy-input" :placeholder="request.options.placeholder" />
        </template>
        <div class="yy-dialog-actions">
          <button type="button" class="yy-btn" @click="finish(false)">取消</button>
          <button type="button" class="yy-btn" :class="request.kind === 'confirm' && request.options.danger ? 'danger' : 'primary'" :disabled="!canSubmit" @click="submit">
            {{ request.options.confirmText ?? '确定' }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
