<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { FileQuestion } from 'lucide-vue-next'
</script>

<template>
  <div class="yy-empty-state">
    <FileQuestion :size="40" :stroke-width="1.25" />
    <h1>找不到内容</h1>
    <p>它不存在，或者已经移到回收站。</p>
    <p><RouterLink to="/" class="yy-btn">回到首页</RouterLink> <RouterLink to="/trash" class="yy-btn">打开回收站</RouterLink></p>
  </div>
</template>
