import { ref } from 'vue'

export const shortcutsOpen = ref(false)
export const shortcutsLoaded = ref(false)

export function openShortcuts() {
  shortcutsLoaded.value = true
  shortcutsOpen.value = true
}
