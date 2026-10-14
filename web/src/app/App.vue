<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { templateRequest } from '../shared/templates'
import { bookToGroupRequest, moveDialog, receiveDocsRequest } from './actions'
import AppLayout from './layout/AppLayout.vue'
import { contextMenuHost } from '../ui/contextMenu'
import { dialogHost } from '../ui/dialog'
import ToastHost from '../ui/ToastHost.vue'
import '../styles/library.css'
const TemplateDialog = defineAsyncComponent(() => import('./templates/TemplateDialog.vue'))
const ReceiveDocsDialog = defineAsyncComponent(() => import('./tree/ReceiveDocsDialog.vue'))
const BookToGroupDialog = defineAsyncComponent(() => import('./tree/BookToGroupDialog.vue'))
// Mounted once loaded, on first use or when the browser is idle (DESIGN 26.5).
const MoveDialog = computed(() => moveDialog.module.value?.default)
const DialogHost = computed(() => dialogHost.module.value?.default)
const ContextMenuHost = computed(() => contextMenuHost.module.value?.default)
</script>

<template>
  <AppLayout />
  <component :is="MoveDialog" v-if="MoveDialog" />
  <component :is="DialogHost" v-if="DialogHost" />
  <component :is="ContextMenuHost" v-if="ContextMenuHost" />
  <ToastHost />
  <TemplateDialog v-if="templateRequest" />
  <ReceiveDocsDialog v-if="receiveDocsRequest" />
  <BookToGroupDialog v-if="bookToGroupRequest" />
</template>
