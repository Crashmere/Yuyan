<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Ellipsis, Keyboard, Link, Maximize2, Minimize2, Plus, Redo2, RemoveFormatting, Search, Undo2 } from 'lucide-vue-next'
import { displayItems, prefs } from '../app/prefs'
import ActionMenu from '../ui/ActionMenu.vue'
import IconButton from '../ui/IconButton.vue'
import type { MenuEntry } from '../ui/menu'
import { clearFormatting, currentStyle, insertItems, listButtons, markButtons, textStyles } from './commands'
import { useEditorContext } from './context'
import { keyLabel, withKey } from './keys'

// The formatting toolbar above the document. It offers only what Markdown can express.
const { editor, tick, ui } = useEditorContext()
const insertButton = ref<HTMLElement | null>(null)

const state = computed(() => {
  void tick.value
  const e = editor.value
  if (!e) return null
  return {
    style: currentStyle(e)?.label ?? '正文',
    marks: Object.fromEntries(markButtons.map((m) => [m.name, e.isActive(m.name)])),
    lists: Object.fromEntries(listButtons.map((m) => [m.name, e.isActive(m.name)])),
    link: e.isActive('link'),
    canUndo: e.can().undo(),
    canRedo: e.can().redo(),
    // Formatting commands make no sense inside a code block.
    inCode: e.isActive('codeBlock'),
  }
})

const styleMenu = computed<MenuEntry[]>(() => {
  void tick.value
  const e = editor.value
  return textStyles.map((s) => ({
    label: s.label,
    icon: s.icon,
    hint: keyLabel(s.shortcut),
    checked: !!e && s.active(e),
    run: () => {
      if (e) s.apply(e)
    },
  }))
})

const insertMenu = computed<MenuEntry[]>(() => {
  const e = editor.value
  const groups = ['插入', '提示块'] as const
  const out: MenuEntry[] = []
  for (const group of groups) {
    if (out.length) out.push(null)
    for (const item of insertItems.filter((i) => i.group === group)) {
      out.push({
        label: item.label,
        icon: item.icon,
        hint: item.markdown,
        run: () => {
          if (!e) return
          if (item.id === 'table') ui.openTableGrid(insertButton.value ?? document.body)
          else item.run(e, ui)
        },
      })
    }
  }
  return out
})

const moreMenu = computed<MenuEntry[]>(() => [{ label: '快捷键说明', icon: Keyboard, hint: keyLabel('Mod-/'), run: () => ui.openShortcuts() }, null, ...displayItems()])
</script>

<template>
  <div v-if="editor && state" class="yy-toolbar" role="toolbar" aria-label="格式">
    <div class="yy-toolbar-inner">
      <IconButton :label="withKey('撤销', 'Mod-Z')" :disabled="!state.canUndo" @mousedown.prevent @click="editor.chain().focus().undo().run()"><Undo2 :size="17" /></IconButton>
      <IconButton :label="withKey('重做', 'Mod-Shift-Z')" :disabled="!state.canRedo" @mousedown.prevent @click="editor.chain().focus().redo().run()"><Redo2 :size="17" /></IconButton>
      <span class="yy-toolbar-sep"></span>
      <ActionMenu :items="styleMenu" align="start" :restore-focus="false">
        <button type="button" class="yy-toolbar-select" :disabled="state.inCode" @mousedown.prevent>
          <span>{{ state.style }}</span><ChevronDown :size="14" />
        </button>
      </ActionMenu>
      <span class="yy-toolbar-sep"></span>
      <IconButton
        v-for="m in markButtons"
        :key="m.name"
        :label="withKey(m.label, m.shortcut)"
        :active="state.marks[m.name]"
        :disabled="state.inCode"
        @mousedown.prevent
        @click="m.toggle(editor)"
      >
        <component :is="m.icon" :size="17" />
      </IconButton>
      <IconButton label="链接" :active="state.link" :disabled="state.inCode" @mousedown.prevent @click="ui.openLink()"><Link :size="17" /></IconButton>
      <span class="yy-toolbar-sep"></span>
      <IconButton
        v-for="m in listButtons"
        :key="m.name"
        :label="withKey(m.label, m.shortcut)"
        :active="state.lists[m.name]"
        @mousedown.prevent
        @click="m.toggle(editor)"
      >
        <component :is="m.icon" :size="17" />
      </IconButton>
      <span class="yy-toolbar-sep"></span>
      <ActionMenu :items="insertMenu" align="start" :restore-focus="false">
        <button ref="insertButton" type="button" class="yy-toolbar-select" @mousedown.prevent><Plus :size="16" /><span>插入</span><ChevronDown :size="14" /></button>
      </ActionMenu>
      <IconButton :label="withKey('清除格式', 'Mod-\\')" @mousedown.prevent @click="clearFormatting(editor)"><RemoveFormatting :size="17" /></IconButton>
      <span class="yy-spacer"></span>
      <IconButton :label="withKey('查找替换', 'Mod-F')" @mousedown.prevent @click="ui.openFind()"><Search :size="17" /></IconButton>
      <IconButton :label="prefs.focusMode ? '退出专注模式' : '专注模式（隐藏侧栏）'" :active="prefs.focusMode" @mousedown.prevent @click="prefs.focusMode = !prefs.focusMode">
        <Minimize2 v-if="prefs.focusMode" :size="17" /><Maximize2 v-else :size="17" />
      </IconButton>
      <ActionMenu :items="moreMenu" :restore-focus="false">
        <IconButton label="更多" @mousedown.prevent><Ellipsis :size="17" /></IconButton>
      </ActionMenu>
    </div>
  </div>
</template>
