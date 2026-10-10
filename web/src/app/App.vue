<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { templateRequest } from '../shared/templates'
import { receiveDocsRequest } from './actions'
import AppLayout from './layout/AppLayout.vue'
import MoveDialog from './tree/MoveDialog.vue'
import DialogHost from '../ui/DialogHost.vue'
import ToastHost from '../ui/ToastHost.vue'
import '../styles/library.css'
const TemplateDialog = defineAsyncComponent(() => import('./templates/TemplateDialog.vue'))
const ReceiveDocsDialog = defineAsyncComponent(() => import('./tree/ReceiveDocsDialog.vue'))
</script>

<template>
  <AppLayout />
  <MoveDialog />
  <DialogHost />
  <ToastHost />
  <TemplateDialog v-if="templateRequest" />
  <ReceiveDocsDialog v-if="receiveDocsRequest" />
</template>
