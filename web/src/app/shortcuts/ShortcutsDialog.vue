<script setup lang="ts">
import { ref, watch } from 'vue'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { X } from 'lucide-vue-next'
import ShortcutKeys from '../../ui/ShortcutKeys.vue'
import { keyboardPlatform, modifierLegend } from '../../ui/shortcutKeys'
import { codeShortcutRows } from '../../code/keymap'

// Loaded by the app shell on demand, without loading the editor.
const open = defineModel<boolean>('open', { required: true })
const active = ref('common')
const portalTarget = ref<HTMLElement | string>('body')
let previousFocus: HTMLElement | null = null
watch(open, value => {
  if (!value) return
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Native code dialogs live in the browser's top layer; help must mount inside that layer.
  portalTarget.value = previousFocus?.closest<HTMLElement>('dialog[open]') ?? 'body'
}, { immediate: true })

function restoreFocus(e: Event) {
  e.preventDefault()
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
}

const groups: { id: string; title: string; description: string; items: [string, string][] }[] = [
  {
    id: 'common',
    title: '常用',
    description: '连按两次 E 或 Esc 切换模式，间隔需小于 0.4 秒。编辑时单按 Esc 先取消选区，无选区时显示保存提示。代码块内的 Cmd/Ctrl + / 保留为行注释。',
    items: [
      ['进入编辑模式（阅读时）', 'E → E'],
      ['新建文档（阅读时）', 'Alt-N'],
      ['保存并回到阅读模式（编辑时）', 'Esc → Esc'],
      ['取消选区并回到选区开头（编辑时）', 'Esc'],
      ['开关左侧栏（非编辑时）', 'Mod-B'],
      ['上一篇文档（阅读时）', 'ArrowUp'],
      ['下一篇文档（阅读时）', 'ArrowDown'],
      ['范围选择图片（编辑时）', 'Shift-点击'],
      ['逐张选择或取消图片（编辑时）', 'Mod-点击'],
      ['逐层扩大选区（编辑时）', 'Alt-L'],
      ['撤销', 'Mod-Z'],
      ['重做', 'Mod-Shift-Z'],
      ['查找替换', 'Mod-F'],
      ['搜索文档', 'Mod-K'],
      ['快捷键说明', 'Mod-/'],
      ['换行（不分段）', 'Shift-Enter'],
    ],
  },
  {
    id: 'text',
    title: '文字',
    description: '选中文字后应用格式，再次使用可取消对应格式。',
    items: [
      ['粗体', 'Mod-B'],
      ['斜体', 'Mod-I'],
      ['下划线', 'Mod-U'],
      ['删除线', 'Mod-Shift-X'],
      ['行内代码', 'Mod-E'],
      ['高亮', 'Mod-Shift-H'],
      ['开关格式刷', 'Mod-Shift-S'],
      ['清除格式', 'Mod-\\'],
    ],
  },
  {
    id: 'paragraph',
    title: '段落',
    description: '更改当前段落的类型，或调整列表缩进。',
    items: [
      ['正文', 'Mod-Alt-0'],
      ['标题 1–6', 'Mod-Alt-1…6'],
      ['无序列表', 'Mod-Shift-8'],
      ['有序列表', 'Mod-Shift-7'],
      ['任务列表', 'Mod-Shift-9'],
      ['引用', 'Mod-Shift-B'],
      ['代码块', 'Mod-Alt-C'],
      ['列表缩进', 'Tab / Mod-]'],
      ['取消缩进', 'Shift-Tab / Mod-['],
      ['折叠块标题进入正文', 'Tab / Enter'],
      ['选择新表格行列数（尺寸面板中）', 'ArrowUp / ArrowDown / ArrowLeft / ArrowRight'],
      ['插入所选大小的表格（尺寸面板中）', 'Enter'],
    ],
  },
  {
    id: 'code',
    title: '代码块',
    description: 'JetBrains 默认方案 · 在编辑模式的代码区内生效。',
    items: [['标题进入代码区', 'Tab'], ...codeShortcutRows()],
  },
  { id: 'markdown', title: 'Markdown', description: '在行首或文字两侧输入符号；标有空格或回车的项目需再按对应按键。', items: [] },
]

const markdown: [string, string, string?][] = [
  ['标题 1–6', '# … ######', 'Space'],
  ['无序列表', '-', 'Space'],
  ['有序列表', '1.', 'Space'],
  ['任务列表', '[ ]', 'Space'],
  ['引用', '>', 'Space'],
  ['Callout', '> [!note]', 'Space'],
  ['代码块', '```', 'Enter'],
  ['分割线', '---'],
  ['公式块', '$$', 'Space'],
  ['行内公式', '$公式$'],
  ['粗体', '**文字**'],
  ['斜体', '*文字*'],
  ['删除线', '~~文字~~'],
  ['高亮', '==文字=='],
  ['行内代码', '`代码`'],
  ['插入菜单', '/ 或 、'],
]

function focusTab() {
  document.querySelector<HTMLElement>('.yy-shortcuts [role=tab][data-state=active]')?.focus({ preventScroll: true })
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="portalTarget">
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-shortcuts yy-shortcuts-shell" :aria-describedby="undefined" @open-auto-focus.prevent="focusTab" @close-auto-focus="restoreFocus" @escape-key-down.prevent="open = false">
        <header class="yy-shortcuts-header">
          <DialogTitle>快捷键</DialogTitle>
          <span class="yy-shortcuts-platform">{{ keyboardPlatform }}</span>
          <DialogClose class="yy-shortcuts-close" aria-label="关闭快捷键" data-tip="关闭"><X :size="18" /></DialogClose>
        </header>
        <TabsRoot v-model="active" class="yy-shortcuts-tabs">
          <TabsList class="yy-shortcuts-nav" aria-label="快捷键分类">
            <TabsTrigger v-for="g in groups" :key="g.id" :value="g.id">{{ g.title }}</TabsTrigger>
          </TabsList>
          <TabsContent v-for="g in groups" :key="g.id" :value="g.id" class="yy-shortcuts-body">
            <p class="yy-shortcuts-description">{{ g.description }}</p>
            <dl v-if="g.id !== 'markdown'" class="yy-shortcut-list">
              <div v-for="[name, combo] in g.items" :key="name" class="yy-shortcut-row">
                <dt>{{ name }}</dt><dd><ShortcutKeys :combo="combo" /></dd>
              </div>
            </dl>
            <dl v-else class="yy-shortcut-list">
              <div v-for="[name, typed, key] in markdown" :key="name" class="yy-shortcut-row">
                <dt>{{ name }}</dt><dd class="yy-shortcut-input"><code>{{ typed }}</code><ShortcutKeys v-if="key" :combo="key" /></dd>
              </div>
            </dl>
          </TabsContent>
        </TabsRoot>
        <footer class="yy-shortcuts-footer">
          <p v-if="active === 'markdown'" class="yy-shortcuts-note">中文全角符号（＃、》、···、￥）同样生效；代码围栏后可紧跟语言名。</p>
          <div v-else class="yy-shortcut-legend">
            <span v-for="key in modifierLegend" :key="key.label">
              <svg v-if="key.path" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="key.path" /></svg>
              <span v-else class="yy-system-key-symbol" aria-hidden="true">{{ key.text }}</span>{{ key.label }}
            </span>
          </div>
          <span class="yy-shortcuts-escape"><ShortcutKeys combo="Esc" />关闭</span>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
