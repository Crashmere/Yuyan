<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { ChevronRight, FolderPlus, House, Plus } from 'lucide-vue-next'
import IconButton from '../../ui/IconButton.vue'
import ContextActions from '../../ui/ContextActions.vue'
import { bookMenu, newBook, newBookGroup } from '../actions'
import { bookSections, loadBooks, state } from '../store'
import { closedBookGroups, toggleBookGroup } from '../bookGroups'

onMounted(() => void loadBooks())
</script>

<template>
  <div class="yy-sidebar-body">
    <nav class="yy-nav">
      <RouterLink to="/" class="yy-nav-item" exact-active-class="active"><House :size="16" />首页</RouterLink>
    </nav>
    <div class="yy-section-head">
      <span>知识库</span>
      <IconButton small label="新建知识库分组" @click="newBookGroup()"><FolderPlus :size="15" /></IconButton>
      <IconButton small label="新建知识库" @click="newBook"><Plus :size="15" /></IconButton>
    </div>
    <nav v-for="group in bookSections" :key="group.id" class="yy-nav">
      <button v-if="state.bookGroups.groups.length" type="button" class="yy-book-group-toggle sidebar" :aria-expanded="!closedBookGroups.has(group.id)" @click="toggleBookGroup(group.id)">
        <ChevronRight :size="14" :class="{ expanded: !closedBookGroups.has(group.id) }" /><span>{{ group.name }}</span><span class="yy-group-count">{{ group.books.length }}</span>
      </button>
      <div class="yy-book-group-content" :class="{ collapsed: state.bookGroups.groups.length > 0 && closedBookGroups.has(group.id) }" :inert="state.bookGroups.groups.length > 0 && closedBookGroups.has(group.id)">
        <div class="yy-book-group-clip sidebar">
          <div class="yy-nav">
            <ContextActions v-for="b in group.books" :key="b.id" :items="bookMenu(b)">
              <RouterLink :to="`/books/${b.id}`" class="yy-nav-item" :class="{ 'in-book-group': state.bookGroups.groups.length }" active-class="active">
                <span class="yy-nav-label">{{ b.name }}</span><span class="yy-nav-count">{{ b.docCount }}</span>
              </RouterLink>
            </ContextActions>
          </div>
        </div>
      </div>
    </nav>
  </div>
</template>
