<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { BookOpen, ChevronRight, FolderPlus, House, Plus } from 'lucide-vue-next'
import IconButton from '../../ui/IconButton.vue'
import { newBook, newBookGroup } from '../actions'
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
      <template v-if="!state.bookGroups.groups.length || !closedBookGroups.has(group.id)">
      <RouterLink v-for="b in group.books" :key="b.id" :to="`/books/${b.id}`" class="yy-nav-item" active-class="active">
        <BookOpen :size="16" /><span class="yy-nav-label">{{ b.name }}</span><span class="yy-nav-count">{{ b.docCount }}</span>
      </RouterLink>
      </template>
    </nav>
  </div>
</template>
