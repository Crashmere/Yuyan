<script setup lang="ts">
import { TooltipProvider } from 'reka-ui'
import AppLayout from './layout/AppLayout.vue'
import MoveDialog from './tree/MoveDialog.vue'
import DialogHost from '../ui/DialogHost.vue'
import ToastHost from '../ui/ToastHost.vue'
</script>

<template>
  <TooltipProvider :delay-duration="500" :skip-delay-duration="200">
    <AppLayout />
    <MoveDialog />
    <DialogHost />
    <ToastHost />
  </TooltipProvider>
</template>
