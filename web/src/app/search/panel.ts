import { ref } from 'vue'

// Whether the search panel is open. The panel's code loads the first time it opens.
export const searchOpen = ref(false)
export const searchLoaded = ref(false)

export function openSearch() {
  searchLoaded.value = true
  searchOpen.value = true
}
