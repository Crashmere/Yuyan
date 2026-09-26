<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-vue-next'
import { toasts } from './toast'

const icons = { info: Info, success: CircleCheck, error: CircleAlert, loading: LoaderCircle }
</script>

<template>
  <div class="yy-toasts" role="status" aria-live="polite">
    <TransitionGroup name="yy-toast">
      <div v-for="t in toasts" :key="t.id" class="yy-toast" :class="t.type">
        <component :is="icons[t.type]" :size="16" :class="{ 'yy-spin': t.type === 'loading' }" />
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>
