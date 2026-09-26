<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { prefs } from '../prefs'
import { state } from '../store'
import Sidebar from './Sidebar.vue'
import TopBar from './TopBar.vue'

const route = useRoute()
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
  <div class="yy-app" :class="{ 'sidebar-collapsed': prefs.sidebarCollapsed, 'drawer-open': drawer }" :style="{ '--yy-sidebar-width': `${prefs.sidebarWidth}px` }">
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
  </div>
</template>
