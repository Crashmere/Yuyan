<script setup lang="ts">
import CalendarPanel from '../../calendar/CalendarPanel.vue'
import { setTitle } from '../router'
import { setPage } from '../store'
setPage(null)
setTitle('日历')
</script>
<template><CalendarPanel /></template>
