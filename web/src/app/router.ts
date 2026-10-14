import { shallowRef } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { base } from '../shared/api'
import { clearJumpShadow } from '../shared/scroll'
import { isModuleLoadError, moduleLoadFailed, moduleReloadURL } from '../shared/moduleLoad'
import { confirm } from '../ui/dialog'
import { heavyToEdit, state } from './store'
import DocView from './views/DocView.vue'
import { captureReadingPosition, type ReadingPosition } from './content/readingPosition'

declare module 'vue-router' {
  interface RouteMeta {
    // Which sidebar the page shows: the workspace (home, knowledge bases) or the current book.
    sidebar: 'workspace' | 'book'
    readingPosition?: ReadingPosition
  }
}

export const router = createRouter({
  history: createWebHistory(base),
  // Only the reading page is part of the app's first load. The other views are loaded when they
  // are opened; the page shell preloads the view of the address it serves (routeViews in
  // internal/server/app.go).
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { sidebar: 'workspace' } },
    { path: '/books/:id', name: 'book', component: () => import('./views/BookView.vue'), meta: { sidebar: 'book' } },
    { path: '/docs/:id', name: 'doc', component: DocView, meta: { sidebar: 'book' } },
    { path: '/docs/:id/edit', name: 'edit', component: () => import('./views/EditView.vue'), meta: { sidebar: 'book' } },
    { path: '/docs/:id/history', name: 'history', component: () => import('./views/HistoryView.vue'), meta: { sidebar: 'book' } },
    { path: '/versions/:id', name: 'version', component: () => import('./views/VersionView.vue'), meta: { sidebar: 'book' } },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { sidebar: 'workspace' } },
    { path: '/trash', name: 'trash', component: () => import('./views/TrashView.vue'), meta: { sidebar: 'workspace' } },
    { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFoundView.vue'), meta: { sidebar: 'workspace' } },
  ],
  // Views handle heading anchors and reading positions after their content has mounted.
  scrollBehavior: (to, _from, saved) => to.meta.readingPosition ? false : saved ?? (to.hash ? false : { top: 0 }),
})

// The edit page whose code is loading or failed to load. A page opened directly has nothing else
// to show meanwhile, so the layout puts a placeholder in its place.
export const editLoading = shallowRef<{ id: number; failed: boolean } | null>(null)

// Opening a very large document in the editor takes seconds and much memory, so every way into it
// asks first (DESIGN 26.6); the server sends such edit addresses opened directly to the reading
// page, which comes back here. Before the progress guard, so no progress shows while asking.
router.beforeEach(async (to, from) => {
  if (to.name !== 'edit' || (from.name === 'edit' && from.params.id === to.params.id)) return
  const id = Number(to.params.id)
  if (!(await heavyToEdit(id))) return
  const ok = await confirm({
    title: '这篇文档很大',
    message: '编辑器打开它可能需要数秒，手机上更久，编辑时也可能卡顿；阅读不受影响。拆分成几篇文档可以加快编辑。',
    confirmText: '仍要编辑',
  })
  if (!ok) return from.matched.length ? false : `/docs/${id}`
})

// The progress bar also covers loading a page's code, such as the editor on first use.
router.beforeEach((to, from) => {
  state.navigating = true
  editLoading.value = to.name === 'edit' ? { id: Number(to.params.id), failed: false } : null
  if (from.name === 'doc' && to.name === 'edit' && from.params.id === to.params.id) {
    to.meta.readingPosition = captureReadingPosition()
  }
})
router.afterEach((to, from, failure) => {
  state.navigating = false
  editLoading.value = null
  if (!failure) moduleReloadURL.value = null
  if (!failure && to.path !== from.path) clearJumpShadow()
})

// A failed route import uses the same explicit, save-aware refresh as other lazy features.
router.onError((error: Error, to) => {
  state.navigating = false
  if (isModuleLoadError(error)) {
    moduleReloadURL.value = router.resolve(to).href
    moduleLoadFailed.value = true
    if (editLoading.value) editLoading.value = { ...editLoading.value, failed: true }
  } else {
    editLoading.value = null
  }
})

export function setTitle(title?: string) {
  document.title = title ? `${title} - 语燕` : '语燕'
}
