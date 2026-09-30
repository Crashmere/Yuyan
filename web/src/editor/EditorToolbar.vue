<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, ChevronDown, Link, Maximize2, Minimize2, Plus, Redo2, Search, Undo2 } from 'lucide-vue-next'
import { prefs } from '../app/prefs'
import ActionMenu from '../ui/ActionMenu.vue'
import IconButton from '../ui/IconButton.vue'
import type { MenuEntry } from '../ui/menu'
import { clearFormatting, currentStyle, insertItems, listButtons, markButtons, textStyles } from './commands'
import { useEditorContext } from './context'
import { keyLabel, withKey } from './keys'
import AlignmentMenu from './AlignmentMenu.vue'
import { shiftHeadingLevel } from './headingLevels'
import { textMarkActive } from './textSelection'
import TextColorMenu from './TextColorMenu.vue'
import TableTools from './TableTools.vue'
import FormatPainterButton from './FormatPainterButton.vue'
import FormatIcon from './FormatIcon.vue'

// The formatting toolbar above the document.
const { editor, tick, ui } = useEditorContext()
const insertButton = ref<HTMLElement | null>(null)

const state = computed(() => {
  void tick.value
  const e = editor.value
  if (!e) return null
  return {
    style: currentStyle(e)?.label ?? '正文',
    marks: Object.fromEntries(markButtons.map((m) => [m.name, textMarkActive(e, m.name)])),
    lists: Object.fromEntries(listButtons.map((m) => [m.name, e.isActive(m.name)])),
    link: e.isActive('link'),
    canUndo: e.can().undo(),
    canRedo: e.can().redo(),
    canPromote: e.can().command(shiftHeadingLevel(-1)),
    canDemote: e.can().command(shiftHeadingLevel(1)),
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
</script>

<template>
  <div v-if="editor && state" class="yy-toolbar" role="toolbar" aria-label="格式">
    <div class="yy-toolbar-inner">
      <ActionMenu :items="insertMenu" align="start" :restore-focus="false">
        <button ref="insertButton" type="button" class="yy-icon-btn yy-toolbar-insert" aria-label="插入" data-tip="插入" @mousedown.prevent><span class="yy-toolbar-insert-symbol"><Plus :size="16" :stroke-width="2.4" /></span></button>
      </ActionMenu>
      <IconButton :label="withKey('撤销', 'Mod-Z')" :disabled="!state.canUndo" @mousedown.prevent @click="editor.chain().focus().undo().run()"><Undo2 :size="17" /></IconButton>
      <IconButton :label="withKey('重做', 'Mod-Shift-Z')" :disabled="!state.canRedo" @mousedown.prevent @click="editor.chain().focus().redo().run()"><Redo2 :size="17" /></IconButton>
      <FormatPainterButton />
      <IconButton :label="withKey('清除格式', 'Mod-\\')" @mousedown.prevent @click="clearFormatting(editor)"><FormatIcon kind="clear" /></IconButton>
      <span class="yy-toolbar-sep"></span>
      <ActionMenu :items="styleMenu" align="start" :restore-focus="false">
        <button type="button" class="yy-toolbar-select" :disabled="state.inCode" @mousedown.prevent>
          <span>{{ state.style }}</span><ChevronDown :size="14" />
        </button>
      </ActionMenu>
      <IconButton label="提升标题等级" :disabled="!state.canPromote" @mousedown.prevent @click="editor.chain().focus().command(shiftHeadingLevel(-1)).run()"><ArrowUp :size="17" /></IconButton>
      <IconButton label="降低标题等级" :disabled="!state.canDemote" @mousedown.prevent @click="editor.chain().focus().command(shiftHeadingLevel(1)).run()"><ArrowDown :size="17" /></IconButton>
      <span class="yy-toolbar-sep"></span>
      <IconButton
        v-for="m in markButtons.filter(m => m.name !== 'highlight')"
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
      <TextColorMenu />
      <span class="yy-toolbar-sep"></span>
      <AlignmentMenu />
      <TableTools />
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
      <span class="yy-spacer"></span>
      <IconButton :label="withKey('查找替换', 'Mod-F')" @mousedown.prevent @click="ui.openFind()"><Search :size="17" /></IconButton>
      <IconButton :label="prefs.focusMode ? '退出专注模式' : '专注模式（隐藏侧栏）'" :active="prefs.focusMode" @mousedown.prevent @click="prefs.focusMode = !prefs.focusMode">
        <Minimize2 v-if="prefs.focusMode" :size="17" /><Maximize2 v-else :size="17" />
      </IconButton>
    </div>
  </div>
</template>
