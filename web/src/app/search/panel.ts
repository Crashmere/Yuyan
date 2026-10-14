import { ref } from 'vue'
import { deferred } from '../../shared/deferred'

// Whether the search panel is open. The panel's code loads the first time it opens, or earlier
// when the browser is idle (DESIGN 26.5).
export const searchOpen = ref(false)
export const searchLoaded = ref(false)
export const searchPanel = deferred(() => import('./SearchPanel.vue'))

export function openSearch() {
  searchLoaded.value = true
  searchOpen.value = true
  searchPanel.load().catch(() => (searchOpen.value = false))
}
