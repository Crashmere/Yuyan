<script setup lang="ts">
import { setTitle } from '../router'
import { setPage } from '../store'
import NotFoundState from './NotFoundState.vue'

setPage(null)
setTitle('找不到内容')
</script>

<template>
  <main class="yy-page"><NotFoundState /></main>
</template>
