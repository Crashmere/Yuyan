<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { isNavigationFailure, NavigationFailureType, RouterView, useRoute, useRouter } from 'vue-router'
import { peekPreloaded, type Doc } from '../../shared/api'
import { editLoading } from '../router'
import { prefs } from '../prefs'
import { pageShortcutAllowed } from '../pageShortcut'
import { openSearch, searchLoaded, searchPanel } from '../search/panel'
import { locate, state } from '../store'
import { newDoc } from '../actions'
import { altLetter } from '../../shared/keyboard'
import { openShortcuts, shortcutsLoaded, shortcutsOpen } from '../shortcuts/panel'
import Sidebar from './Sidebar.vue'
import TopBar from './TopBar.vue'
import ModuleLoadNotice from './ModuleLoadNotice.vue'

// The title of a directly opened edit page, from the data the server sent with it.
const placeholderTitle = computed(() => editLoading.value && peekPreloaded<Doc>(`docs/${editLoading.value.id}`)?.title)

const SearchPanel = computed(() => searchPanel.module.value?.default)
const ShortcutsDialog = defineAsyncComponent(() => import('../shortcuts/ShortcutsDialog.vue'))

const route = useRoute()
const router = useRouter()
let creatingDoc = false

// Cmd/Ctrl+K opens the search panel everywhere, including in the editor.
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.repeat || e.isComposing) return
  if (altLetter(e, 'n') && (route.name === 'doc' || route.name === 'book') && pageShortcutAllowed(e)) {
    if (state.bookId === null || state.navigating || state.loading || Number(route.params.id) !== (route.name === 'doc' ? state.docId : state.bookId)) return
    const current = route.name === 'doc' ? locate(state.bookId, state.docId)?.node : undefined
    if (route.name === 'doc' && !current) return
    e.preventDefault()
    if (!creatingDoc) {
      creatingDoc = true
      void newDoc(state.bookId, current?.kind === 'group' ? current.id : current?.parentId ?? null).finally(() => { creatingDoc = false })
    }
    return
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '/') {
    // CodeMirror owns Mod-/ for line comments; every other page and input opens help.
    if (e.target instanceof Element && e.target.closest('.cm-editor')) return
    e.preventDefault()
    openShortcuts()
    return
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' && !e.isComposing) {
    e.preventDefault()
    openSearch()
    return
  }
  if (route.name !== 'edit' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b' && pageShortcutAllowed(e)) {
    e.preventDefault()
    if (matchMedia('(max-width: 1700px)').matches) drawer.value = !drawer.value
    else prefs.sidebarCollapsed = !prefs.sidebarCollapsed
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
// On narrow screens the sidebar is a drawer over the page.
const drawer = ref(false)
// Selecting the current document also closes the drawer; toggling a tree group does not navigate.
const stopAfterEach = router.afterEach((_to, _from, failure) => {
  if (!failure || isNavigationFailure(failure, NavigationFailureType.duplicated)) drawer.value = false
})
onBeforeUnmount(stopAfterEach)

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
      <ModuleLoadNotice />
      <div v-if="state.loading > 0 || state.navigating" class="yy-progress"></div>
      <RouterView v-slot="{ Component, route: r }">
        <component :is="Component" v-if="Component" :key="r.path" />
        <main v-else-if="editLoading" class="yy-edit-page yy-edit-placeholder" :aria-busy="!editLoading.failed">
          <div class="yy-edit-placeholder-body">
            <h1 v-if="placeholderTitle">{{ placeholderTitle }}</h1>
            <p v-if="editLoading.failed" class="yy-page-error">编辑器没有加载成功。</p>
            <template v-else><span v-for="n in 5" :key="n" class="yy-edit-placeholder-line"></span></template>
          </div>
        </main>
      </RouterView>
    </div>
    <component :is="SearchPanel" v-if="searchLoaded && SearchPanel" />
    <ShortcutsDialog v-if="shortcutsLoaded" v-model:open="shortcutsOpen" />
  </div>
</template>
