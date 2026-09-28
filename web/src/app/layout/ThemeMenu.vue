<script setup lang="ts">
import { computed } from 'vue'
import { Keyboard, Monitor, Moon, Sun } from 'lucide-vue-next'
import ActionMenu from '../../ui/ActionMenu.vue'
import IconButton from '../../ui/IconButton.vue'
import type { MenuEntry } from '../../ui/menu'
import { prefs, type Theme } from '../prefs'
import { openShortcuts } from '../shortcuts/panel'
import { keyLabel } from '../../editor/keys'

const options: { theme: Theme; label: string; icon: typeof Sun }[] = [
  { theme: 'system', label: '跟随系统', icon: Monitor },
  { theme: 'light', label: '浅色', icon: Sun },
  { theme: 'dark', label: '深色', icon: Moon },
]
const current = computed(() => options.find((o) => o.theme === prefs.theme) ?? options[0])
const items = computed<MenuEntry[]>(() => [
  ...options.map((o) => ({ label: o.label, icon: o.icon, checked: o.theme === prefs.theme, run: () => void (prefs.theme = o.theme) })),
  null,
  { label: '快捷键说明', icon: Keyboard, hint: keyLabel('Mod-/'), run: openShortcuts },
])
</script>

<template>
  <ActionMenu :items="items" align="end">
    <IconButton :label="`外观：${current.label}`"><component :is="current.icon" :size="16" /></IconButton>
  </ActionMenu>
</template>
