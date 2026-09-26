import { ref } from 'vue'

export const toast = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

export function notify(message: string, ms = 4000) {
  toast.value = message
  clearTimeout(timer)
  if (ms > 0) timer = setTimeout(() => (toast.value = ''), ms)
}
