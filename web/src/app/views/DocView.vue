<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Ellipsis, FileText, Folder, PencilLine, ScanText, TableOfContents } from 'lucide-vue-next'
import { api, ApiError, errorMessage, type DocView, type RecentChanges } from '../../shared/api'
import ActionMenu from '../../ui/ActionMenu.vue'
import IconButton from '../../ui/IconButton.vue'
import { toast } from '../../ui/toast'
import { useModeShortcut } from '../modeShortcut'
import { pageShortcutAllowed } from '../pageShortcut'
import { newDoc, nodeMenu } from '../actions'
import DocContent from '../content/DocContent.vue'
import Backlinks from '../content/Backlinks.vue'
import Toc from '../content/Toc.vue'
import { prefs, recordView } from '../prefs'
import { setTitle } from '../router'
import { loading, loadTree, locate, setPage, state } from '../store'
import { formatTime } from '../time'
import NotFoundState from './NotFoundState.vue'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const readingPosition = route.meta.readingPosition
const view = ref<DocView | null>(null)
const missing = ref(false)
const failure = ref('')
const tocOpen = ref(false)
const content = ref<InstanceType<typeof DocContent> | null>(null)
const titleElement = ref<HTMLElement | null>(null)
const changes = ref<RecentChanges | null>(null)
const changesLoading = ref(false)
const changesError = ref('')
const changeCount = ref(0)
const changeAt = ref(0)
let markers: ReturnType<typeof import('../content/recentChanges').showRecentChanges> | undefined
let changeRequest = 0, markerRequest = 0

function clearMarkers() {
  markerRequest++
  markers?.destroy(); markers = undefined
  changeCount.value = 0; changeAt.value = 0
}

async function markChanges() {
  clearMarkers()
  if (!prefs.recentChanges || !changes.value?.baseline || !view.value) return
  const request = markerRequest
  const { showRecentChanges } = await import('../content/recentChanges')
  await nextTick()
  if (disposed || request !== markerRequest || !titleElement.value) return
  const source = content.value?.source()
  markers = showRecentChanges({
    root: source?.root ?? titleElement.value.closest<HTMLElement>('.yy-article')!, elements: source?.elements ?? [],
    html: view.value.html, beforeHTML: changes.value.baseline.html,
    title: titleElement.value, titleText: title.value, beforeTitle: changes.value.baseline.title,
  })
  changeCount.value = markers.count
}

async function loadChanges() {
  const request = ++changeRequest
  clearMarkers(); changes.value = null; changesError.value = ''; changesLoading.value = false
  if (!prefs.recentChanges || view.value?.doc.kind !== 'doc') return
  changesLoading.value = true
  try {
    const result = await api<RecentChanges>(`docs/${id}/recent-changes?revision=${view.value.doc.revision}`)
    if (disposed || request !== changeRequest) return
    changes.value = result
    await markChanges()
  } catch (e) {
    if (!disposed && request === changeRequest) { clearMarkers(); changesError.value = errorMessage(e) }
  } finally {
    if (!disposed && request === changeRequest) changesLoading.value = false
  }
}
function contentReady() { void markChanges().catch(e => { changesError.value = errorMessage(e) }) }
function nextChange(direction: number) { changeAt.value = markers?.go(direction) ?? 0 }
watch(() => [prefs.recentChanges, view.value], () => { void loadChanges() })
onBeforeUnmount(() => { changeRequest++; clearMarkers() })
let disposed = false
onBeforeUnmount(() => { disposed = true })
// Up to this width (the breakpoint in app.css) the outline is a drawer opened from the top bar;
// wider, it sits beside the text (Toc.vue).
const drawerQuery = matchMedia('(max-width: 1180px)')
const drawer = ref(drawerQuery.matches)
const onDrawerQuery = (e: MediaQueryListEvent) => (drawer.value = e.matches)
drawerQuery.addEventListener('change', onDrawerQuery)
onBeforeUnmount(() => drawerQuery.removeEventListener('change', onDrawerQuery))

// The editor is a large download; start fetching it when the pointer reaches the edit button.
const prefetchEditor = () => void import('./EditView.vue')

useModeShortcut('e', '连按两次 E 键进入编辑模式', (e) => {
  return view.value?.doc.kind === 'doc' && !(e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]'))
}, () => {
  prefetchEditor()
  void router.push(`/docs/${id}/edit`)
})

// Search results open documents with ?hl=<query>, which is highlighted in the content.
const highlight = computed(() => (typeof route.query.hl === 'string' ? route.query.hl : ''))
const node = computed(() => locate(state.bookId, id)?.node)
const children = computed(() => node.value ? node.value.children ?? [] : view.value?.children ?? [])
const menu = computed(() => (view.value && node.value ? nodeMenu(view.value.doc.bookId, node.value, { history: true }) : []))
const title = computed(() => node.value?.title ?? view.value?.doc.title ?? '')
// A new document holds one empty paragraph; treat anything without text or visible blocks as empty.
const empty = computed(() => !!view.value && view.value.chars === 0 && !/<(img|table|pre|hr|div)\b/.test(view.value.html))
// Titles shown on this page follow the tree, which stays current after renames elsewhere.
const titleOf = (n: { id: number; title: string }) => locate(state.bookId, n.id)?.node.title ?? n.title

function changeDoc(e: KeyboardEvent) {
  if (!view.value || state.navigating || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || !pageShortcutAllowed(e)) return
  e.preventDefault()
  const target = e.key === 'ArrowUp' ? view.value.prev : view.value.next
  if (target) void router.push(`/docs/${target.id}`)
}
onMounted(() => window.addEventListener('keydown', changeDoc))
onBeforeUnmount(() => window.removeEventListener('keydown', changeDoc))

onMounted(async () => {
  try {
    const v = await loading(api<DocView>(`docs/${id}/view`))
    if (disposed) return
    view.value = v
    setPage(v.doc.bookId, v.doc.id)
    setTitle(v.doc.title)
    void loadTree(v.doc.bookId).catch(() => toast('目录更新失败，请刷新页面重试', 'error', { key: 'tree-refresh' }))
    if (v.doc.kind === 'doc') recordView({ id: v.doc.id, title: v.doc.title, bookId: v.doc.bookId, bookName: v.doc.bookName })
  } catch (e) {
    if (disposed) return
    if (e instanceof ApiError && e.status === 404) {
      missing.value = true
      setPage(null)
      setTitle('找不到内容')
    } else {
      failure.value = errorMessage(e)
    }
  }
})
</script>

<template>
  <Teleport defer to="#yy-topbar-actions">
    <template v-if="view">
      <RouterLink v-if="view.doc.kind === 'doc'" :to="`/docs/${id}/edit`" class="yy-btn primary" @mouseenter="prefetchEditor" @focus="prefetchEditor">
        <PencilLine :size="15" />编辑
      </RouterLink>
      <ActionMenu :items="menu"><IconButton label="更多操作"><Ellipsis :size="18" /></IconButton></ActionMenu>
      <IconButton v-if="view.toc.length && drawer" class="yy-toc-btn" label="大纲" :active="tocOpen" @click="tocOpen = !tocOpen">
        <TableOfContents :size="18" />
      </IconButton>
    </template>
  </Teleport>

  <main v-if="missing" class="yy-page"><NotFoundState /></main>
  <main v-else-if="failure" class="yy-page"><p class="yy-page-error">加载失败：{{ failure }}</p></main>
  <main v-else-if="view" class="yy-doc-page" :class="{ 'has-toc': view.toc.length > 0, 'toc-open': tocOpen }">
    <article class="yy-article">
      <h1 ref="titleElement" class="yy-doc-title">{{ title }}</h1>
      <div class="yy-doc-meta">
        <span>更新于 {{ formatTime(view.doc.updatedAt) }}</span>
        <span v-if="view.doc.kind === 'doc'">{{ view.chars.toLocaleString() }} 字</span>
        <button v-if="view.doc.kind === 'doc'" type="button" class="yy-recent-toggle" :class="{ active: prefs.recentChanges }" :aria-pressed="prefs.recentChanges" data-tip="标记最近一次修改，保留正文原有格式" @click="prefs.recentChanges = !prefs.recentChanges">
          <ScanText :size="14" />最近修改
        </button>
      </div>
      <div v-if="view.doc.kind === 'doc' && prefs.recentChanges" class="yy-recent-toolbar" aria-label="最近修改">
        <div class="yy-recent-status" role="status">
          <span v-if="changesLoading">正在查找最近修改…</span>
          <template v-else-if="changesError"><span>{{ changesError }}</span><button type="button" class="yy-link-btn" @click="loadChanges">重试</button></template>
          <span v-else-if="changes && !changes.baseline">没有可比较的历史版本（历史保留 30 天）</span>
          <template v-else-if="changes?.baseline">
            <span class="yy-recent-legend" aria-hidden="true"></span>
            <span>{{ changeCount ? `${changeCount} 处修改 · 紫色双线与边标` : '当前正文没有可标记的修改' }}</span>
            <RouterLink :to="`/versions/${changes.baseline.id}?compare=current`" class="yy-link-btn">查看完整差异</RouterLink>
          </template>
        </div>
        <div v-if="changeCount" class="yy-recent-navigation">
          <IconButton label="上一处修改" small @click="nextChange(-1)"><ArrowLeft :size="15" /></IconButton>
          <span>{{ changeAt || '—' }} / {{ changeCount }}</span>
          <IconButton label="下一处修改" small @click="nextChange(1)"><ArrowRight :size="15" /></IconButton>
        </div>
        <p v-if="!changesLoading && !changesError && changes?.summary" class="yy-recent-summary">{{ changeCount ? '删除内容可在完整差异中查看。' : changes.summary.labels.join(' · ') }}</p>
      </div>
      <template v-if="view.doc.kind === 'group'">
        <ul v-if="children.length" class="yy-child-list">
          <li v-for="c in children" :key="c.id">
            <RouterLink :to="`/docs/${c.id}`"><component :is="c.kind === 'group' ? Folder : FileText" :size="16" />{{ titleOf(c) }}</RouterLink>
          </li>
        </ul>
        <div v-else class="yy-empty-inline">
          这个分组下还没有文档。
          <button type="button" class="yy-link-btn" @click="newDoc(view.doc.bookId, view.doc.id)">新建一篇</button>
        </div>
      </template>
      <div v-else-if="empty" class="yy-empty-inline">
        这篇文档还是空的。<RouterLink :to="`/docs/${id}/edit`" class="yy-link-btn">开始写作</RouterLink>
      </div>
      <DocContent v-else ref="content" :html="view.html" :math="view.hasMath" :mermaid="view.hasMermaid" :images="view.images" :highlight="highlight" :fold-key="String(view.doc.id)" :reading-position="readingPosition" @ready="contentReady" />
      <Backlinks v-if="view.doc.kind === 'doc'" :doc-id="id" />
      <nav v-if="view.prev || view.next" class="yy-pager">
        <RouterLink v-if="view.prev" :to="`/docs/${view.prev.id}`" class="prev">
          <span class="yy-pager-label"><ArrowLeft :size="14" />上一篇</span><span class="yy-pager-title">{{ titleOf(view.prev) }}</span>
        </RouterLink>
        <RouterLink v-if="view.next" :to="`/docs/${view.next.id}`" class="next">
          <span class="yy-pager-label">下一篇<ArrowRight :size="14" /></span><span class="yy-pager-title">{{ titleOf(view.next) }}</span>
        </RouterLink>
      </nav>
    </article>
    <aside v-if="view.toc.length" class="yy-doc-aside" :class="{ 'is-peek': !prefs.readingOutline }">
      <Toc :items="view.toc" @navigate="tocOpen = false" />
    </aside>
    <div v-if="tocOpen" class="yy-aside-mask" @click="tocOpen = false"></div>
  </main>
</template>
