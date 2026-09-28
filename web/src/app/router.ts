import { createRouter, createWebHistory } from 'vue-router'
import { base } from '../shared/api'
import { isModuleLoadError, moduleLoadFailed, moduleReloadURL } from '../shared/moduleLoad'
import { state } from './store'
import HomeView from './views/HomeView.vue'
import BookView from './views/BookView.vue'
import DocView from './views/DocView.vue'
import HistoryView from './views/HistoryView.vue'
import VersionView from './views/VersionView.vue'
import SearchView from './views/SearchView.vue'
import TrashView from './views/TrashView.vue'
import NotFoundView from './views/NotFoundView.vue'
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
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { sidebar: 'workspace' } },
    { path: '/books/:id', name: 'book', component: BookView, meta: { sidebar: 'book' } },
    { path: '/docs/:id', name: 'doc', component: DocView, meta: { sidebar: 'book' } },
    // The editor is loaded only when it is opened.
    { path: '/docs/:id/edit', name: 'edit', component: () => import('./views/EditView.vue'), meta: { sidebar: 'book' } },
    { path: '/docs/:id/history', name: 'history', component: HistoryView, meta: { sidebar: 'book' } },
    { path: '/versions/:id', name: 'version', component: VersionView, meta: { sidebar: 'book' } },
    { path: '/search', name: 'search', component: SearchView, meta: { sidebar: 'workspace' } },
    { path: '/trash', name: 'trash', component: TrashView, meta: { sidebar: 'workspace' } },
    { path: '/:pathMatch(.*)*', name: 'notfound', component: NotFoundView, meta: { sidebar: 'workspace' } },
  ],
  // Views handle heading anchors and reading positions after their content has mounted.
  scrollBehavior: (to, _from, saved) => to.meta.readingPosition ? false : saved ?? (to.hash ? false : { top: 0 }),
})

// The progress bar also covers loading a page's code, such as the editor on first use.
router.beforeEach((to, from) => {
  state.navigating = true
  if (from.name === 'doc' && to.name === 'edit' && from.params.id === to.params.id) {
    to.meta.readingPosition = captureReadingPosition()
  }
})
router.afterEach((_to, _from, failure) => {
  state.navigating = false
  if (!failure) moduleReloadURL.value = null
})

// A failed route import uses the same explicit, save-aware refresh as other lazy features.
router.onError((error: Error, to) => {
  state.navigating = false
  if (isModuleLoadError(error)) {
    moduleReloadURL.value = router.resolve(to).href
    moduleLoadFailed.value = true
  }
})

export function setTitle(title?: string) {
  document.title = title ? `${title} - 语燕` : '语燕'
}
