import { shallowRef } from 'vue'
import { deferred } from '../shared/deferred'

// In-app replacements for window.confirm and window.prompt. Requests queue up, so a dialog opened
// while another is showing waits for its turn. DialogHost shows them once loaded (DESIGN 26.5).

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
export const dialogHost = deferred(() => import('./DialogHost.vue'))
const queue: DialogRequest[] = []

function open(request: DialogRequest) {
  if (currentDialog.value) queue.push(request)
  else currentDialog.value = request
  // Without the dialog nobody can answer, so the waiting requests count as cancelled.
  dialogHost.load().catch(() => {
    for (const r of [currentDialog.value, ...queue.splice(0)]) {
      if (r?.kind === 'confirm') r.resolve(false)
      else r?.resolve(null)
    }
    currentDialog.value = null
  })
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
