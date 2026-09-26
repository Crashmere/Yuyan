<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Bird, PanelLeftClose, Search, Trash2 } from 'lucide-vue-next'
import { withKey } from '../../editor/keys'
import IconButton from '../../ui/IconButton.vue'
import { prefs } from '../prefs'
import { openSearch } from '../search/panel'
import { state } from '../store'
import BookPanel from './BookPanel.vue'
import ThemeMenu from './ThemeMenu.vue'
import WorkspacePanel from './WorkspacePanel.vue'

const route = useRoute()
const bookId = computed(() => (route.meta.sidebar === 'book' ? state.bookId : null))
</script>

<template>
  <div class="yy-sidebar-inner">
    <div class="yy-sidebar-head">
      <RouterLink to="/" class="yy-brand"><span class="yy-brand-mark"><Bird :size="16" /></span>语燕</RouterLink>
      <IconButton :label="withKey('搜索', 'Mod-K')" @click="openSearch()"><Search :size="17" /></IconButton>
      <IconButton class="yy-collapse-btn" label="收起侧栏" @click="prefs.sidebarCollapsed = true"><PanelLeftClose :size="17" /></IconButton>
    </div>
    <BookPanel v-if="bookId != null" :key="bookId" :book-id="bookId" />
    <WorkspacePanel v-else />
    <div class="yy-sidebar-foot">
      <RouterLink to="/trash" class="yy-nav-item compact" active-class="active"><Trash2 :size="16" />回收站</RouterLink>
      <ThemeMenu />
    </div>
  </div>
</template>
