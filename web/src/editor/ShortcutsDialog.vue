<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { keyLabel } from './keys'

// The keyboard shortcuts and Markdown shortcuts the editor understands, opened with Cmd/Ctrl+/.
const open = defineModel<boolean>('open', { required: true })

const groups: { title: string; items: [string, string][] }[] = [
  {
    title: '常用',
    items: [
      ['撤销', 'Mod-Z'],
      ['重做', 'Mod-Shift-Z'],
      ['查找替换', 'Mod-F'],
      ['添加链接', 'Mod-K'],
      ['快捷键说明', 'Mod-/'],
      ['换行（不分段）', 'Shift-Enter'],
    ],
  },
  {
    title: '文字',
    items: [
      ['粗体', 'Mod-B'],
      ['斜体', 'Mod-I'],
      ['下划线', 'Mod-U'],
      ['删除线', 'Mod-Shift-X'],
      ['行内代码', 'Mod-E'],
      ['高亮', 'Mod-Shift-H'],
      ['清除格式', 'Mod-\\'],
    ],
  },
  {
    title: '段落',
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
    ],
  },
]

const markdown: [string, string][] = [
  ['# 空格', '标题（# 到 ######）'],
  ['- 空格', '无序列表'],
  ['1. 空格', '有序列表'],
  ['[ ] 空格', '任务列表'],
  ['> 空格', '引用'],
  ['> [!note] 空格', 'Callout'],
  ['``` 回车', '代码块，可以紧跟语言名'],
  ['---', '分割线'],
  ['$$ 空格', '公式块'],
  ['$公式$', '行内公式'],
  ['**文字**', '粗体'],
  ['*文字*', '斜体'],
  ['~~文字~~', '删除线'],
  ['==文字==', '高亮'],
  ['`代码`', '行内代码'],
  ['/ 或 、', '插入菜单'],
]

function label(combo: string): string {
  return combo
    .split(' / ')
    .map((part) => (part.includes('…') ? keyLabel(part.replace('1…6', '1')).replace(/1$/, '1…6') : keyLabel(part)))
    .join(' / ')
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-shortcuts" :aria-describedby="undefined">
        <DialogTitle class="yy-dialog-title">快捷键</DialogTitle>
        <div class="yy-shortcuts-grid">
          <section v-for="g in groups" :key="g.title">
            <h3>{{ g.title }}</h3>
            <dl>
              <template v-for="[name, combo] in g.items" :key="name">
                <dt>{{ name }}</dt>
                <dd><kbd>{{ label(combo) }}</kbd></dd>
              </template>
            </dl>
          </section>
          <section class="yy-shortcuts-md">
            <h3>Markdown 快捷输入</h3>
            <dl>
              <template v-for="[typed, result] in markdown" :key="typed">
                <dt><kbd>{{ typed }}</kbd></dt>
                <dd>{{ result }}</dd>
              </template>
            </dl>
          </section>
        </div>
        <p class="yy-dialog-message">中文输入法下输入的全角符号（如 ＃、》、···、￥）同样生效。</p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
