<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { BookOpen, House, Plus } from 'lucide-vue-next'
import IconButton from '../../ui/IconButton.vue'
import { newBook } from '../actions'
import { loadBooks, state } from '../store'

onMounted(() => void loadBooks())
</script>

<template>
  <div class="yy-sidebar-body">
    <nav class="yy-nav">
      <RouterLink to="/" class="yy-nav-item" exact-active-class="active"><House :size="16" />首页</RouterLink>
    </nav>
    <div class="yy-section-head">
      <span>知识库</span>
      <IconButton small label="新建知识库" @click="newBook"><Plus :size="15" /></IconButton>
    </div>
    <nav class="yy-nav">
      <RouterLink v-for="b in state.books" :key="b.id" :to="`/books/${b.id}`" class="yy-nav-item" active-class="active">
        <BookOpen :size="16" /><span class="yy-nav-label">{{ b.name }}</span><span class="yy-nav-count">{{ b.docCount }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
