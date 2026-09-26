import { toast } from '../ui/toast'

// Editor messages share one toast, so an upload's progress is replaced by its result.
export function notify(message: string, ms = 4000) {
  const type = ms === 0 ? 'loading' : /失败/.test(message) ? 'error' : 'info'
  toast(message, type, { key: 'editor', ms })
}
