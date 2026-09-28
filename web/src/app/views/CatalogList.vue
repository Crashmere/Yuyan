<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { TreeNode } from '../../shared/api'
import { fromNow } from '../time'

// The full directory on a knowledge base's home page.
defineOptions({ name: 'CatalogList' })
defineProps<{ nodes: TreeNode[]; depth?: number }>()
</script>

<template>
  <ul class="yy-catalog" :class="{ nested: (depth ?? 0) > 0 }">
    <li v-for="n in nodes" :key="n.id">
      <div class="yy-catalog-row" :class="n.kind">
        <RouterLink v-if="n.kind === 'doc'" :to="`/docs/${n.id}`" class="yy-catalog-title">{{ n.title }}</RouterLink>
        <span v-else class="yy-catalog-title">{{ n.title }}</span>
        <span v-if="n.kind === 'doc'" class="yy-catalog-meta">
          <span v-if="n.images">{{ n.images.toLocaleString() }} 张图片</span>
          <span>{{ n.chars.toLocaleString() }} 字</span>
          <span class="yy-catalog-time">{{ fromNow(n.updatedAt) }}</span>
        </span>
      </div>
      <CatalogList v-if="n.children?.length" :nodes="n.children" :depth="(depth ?? 0) + 1" />
    </li>
  </ul>
</template>
