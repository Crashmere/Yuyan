import { shallowRef } from 'vue'

export const moduleLoadFailed = shallowRef(false)
export const moduleReloadGuard = shallowRef<(() => Promise<boolean>) | null>(null)
export const moduleReloadURL = shallowRef<string | null>(null)
const failures = new WeakSet<object>()

export function isModuleLoadError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (failures.has(error) ||
    ('message' in error && /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload CSS/i.test(String(error.message))))
}

export function installModuleLoadRecovery() {
  // Vite reports both the initial import and nested lazy chunks (diagram types, code languages).
  // Keep the rejection: callers must not mistake a missing module for a successful import.
  window.addEventListener('vite:preloadError', event => {
    const error = (event as Event & { payload: unknown }).payload
    if (error && typeof error === 'object') failures.add(error)
    moduleLoadFailed.value = true
  })
}
