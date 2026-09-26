<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Menu, PanelLeftOpen } from 'lucide-vue-next'
import IconButton from '../../ui/IconButton.vue'
import { prefs } from '../prefs'
import { bookOf, locate, state } from '../store'

defineEmits<{ 'open-drawer': [] }>()
const route = useRoute()

interface Crumb {
  label: string
  to?: string
}

const pageTitles: Record<string, string> = { home: '首页', search: '搜索', trash: '回收站', notfound: '找不到内容' }

// Pages put their own buttons into #yy-topbar-actions; the breadcrumb comes from the current
// knowledge base and document.
const crumbs = computed<Crumb[]>(() => {
  const name = String(route.name ?? '')
  if (pageTitles[name]) return [{ label: pageTitles[name] }]
  const book = bookOf(state.bookId)
  const out: Crumb[] = book ? [{ label: book.name, to: `/books/${book.id}` }] : []
  const found = locate(state.bookId, state.docId)
  if (found) {
    for (const p of found.path) out.push({ label: p.title, to: p.kind === 'doc' ? `/docs/${p.id}` : undefined })
    out.push({ label: found.node.title, to: name === 'doc' ? undefined : `/docs/${found.node.id}` })
  }
  if (name === 'history') out.push({ label: '历史版本' })
  if (name === 'version') out.push({ label: '版本预览' })
  if (name === 'book' && out.length) delete out[0].to
  return out
})
</script>

<template>
  <header class="yy-topbar">
    <IconButton class="yy-drawer-btn" label="打开目录" @click="$emit('open-drawer')"><Menu :size="18" /></IconButton>
    <IconButton v-if="prefs.sidebarCollapsed" class="yy-expand-btn" label="展开侧栏" @click="prefs.sidebarCollapsed = false"><PanelLeftOpen :size="18" /></IconButton>
    <nav class="yy-crumbs" aria-label="位置">
      <template v-for="(c, i) in crumbs" :key="i">
        <span v-if="i > 0" class="yy-crumb-sep">/</span>
        <RouterLink v-if="c.to" :to="c.to" class="yy-crumb" :class="{ current: i === crumbs.length - 1 }" :title="c.label">{{ c.label }}</RouterLink>
        <span v-else class="yy-crumb" :class="{ current: i === crumbs.length - 1 }" :title="c.label">{{ c.label }}</span>
      </template>
    </nav>
    <div id="yy-topbar-actions" class="yy-topbar-actions"></div>
  </header>
</template>
