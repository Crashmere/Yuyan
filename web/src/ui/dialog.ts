import { shallowRef } from 'vue'

// In-app replacements for window.confirm and window.prompt. Requests queue up, so a dialog opened
// while another is showing waits for its turn.

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  label?: string
  value?: string
  placeholder?: string
  confirmText?: string
  multiline?: boolean
  // An empty answer is allowed only when set, e.g. for clearing a description.
  allowEmpty?: boolean
}

export type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

export const currentDialog = shallowRef<DialogRequest | null>(null)
const queue: DialogRequest[] = []

function open(request: DialogRequest) {
  if (currentDialog.value) queue.push(request)
  else currentDialog.value = request
}

export function closeDialog() {
  currentDialog.value = queue.shift() ?? null
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', options, resolve }))
}

export function prompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'prompt', options, resolve }))
}
