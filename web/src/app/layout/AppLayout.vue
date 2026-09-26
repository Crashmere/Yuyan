<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { prefs } from '../prefs'
import { openSearch, searchLoaded } from '../search/panel'
import { state } from '../store'
import Sidebar from './Sidebar.vue'
import TopBar from './TopBar.vue'

const SearchPanel = defineAsyncComponent(() => import('../search/SearchPanel.vue'))

const route = useRoute()

// Cmd/Ctrl+K opens the search panel everywhere, including in the editor.
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' && !e.isComposing) {
    e.preventDefault()
    openSearch()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
// On narrow screens the sidebar is a drawer over the page.
const drawer = ref(false)
watch(() => route.fullPath, () => (drawer.value = false))

function resize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => (prefs.sidebarWidth = Math.round(Math.min(480, Math.max(200, ev.clientX))))
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}
</script>

<template>
  <div
    class="yy-app"
    :class="{ 'sidebar-collapsed': prefs.sidebarCollapsed, 'drawer-open': drawer, 'focus-mode': prefs.focusMode && route.name === 'edit' }"
    :style="{ '--yy-sidebar-width': `${prefs.sidebarWidth}px` }"
  >
    <aside class="yy-sidebar" aria-label="导航">
      <Sidebar />
      <div class="yy-sidebar-resizer" role="separator" aria-orientation="vertical" @pointerdown.prevent="resize" @dblclick="prefs.sidebarWidth = 264"></div>
    </aside>
    <div class="yy-drawer-mask" @click="drawer = false"></div>
    <div class="yy-main">
      <TopBar @open-drawer="drawer = true" />
      <div v-if="state.loading > 0 || state.navigating" class="yy-progress"></div>
      <RouterView v-slot="{ Component, route: r }">
        <component :is="Component" :key="r.path" />
      </RouterView>
    </div>
    <SearchPanel v-if="searchLoaded" />
  </div>
</template>
