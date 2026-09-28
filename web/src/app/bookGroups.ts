import { reactive } from 'vue'

const key = 'yuyan:closed-book-groups'
function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch { return [] }
}
export const closedBookGroups = reactive(new Set(read()))
export function toggleBookGroup(id: string) {
  if (closedBookGroups.has(id)) closedBookGroups.delete(id)
  else closedBookGroups.add(id)
  try { localStorage.setItem(key, JSON.stringify([...closedBookGroups])) } catch { /* storage unavailable */ }
}
