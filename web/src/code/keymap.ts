// JetBrains default keymaps. Commands and both help surfaces consume this same table.
export const codeKeys = [
  { action: 'undo', label: '撤销', key: 'Mod-z' },
  { action: 'redo', label: '重做', key: 'Mod-Shift-z' },
  { action: 'find', label: '块内查找', key: 'Mod-f' },
  { action: 'replace', label: '块内替换', key: 'Mod-r' },
  { action: 'format', label: '格式化代码', key: 'Mod-Alt-l' },
  { action: 'expand', label: '逐层扩大选区', key: 'Alt-l' },
  { action: 'shrink', label: '逐层缩小选区', key: 'Alt-Shift-l' },
  { action: 'indent', label: '缩进（4 个空格）', key: 'Tab' },
  { action: 'unindent', label: '取消缩进', key: 'Shift-Tab' },
  { action: 'comment', label: '切换行注释', key: 'Mod-/' },
  { action: 'blockComment', label: '切换块注释', key: 'Mod-Shift-/', mac: 'Mod-Alt-/' },
  { action: 'duplicate', label: '复制行或选中的内容', key: 'Mod-d' },
  { action: 'delete', label: '删除当前行', key: 'Ctrl-y', mac: 'Mod-Backspace' },
  { action: 'moveUp', label: '上移行', key: 'Alt-Shift-ArrowUp' },
  { action: 'moveDown', label: '下移行', key: 'Alt-Shift-ArrowDown' },
  { action: 'next', label: '选中下一个相同词', key: 'Alt-j', mac: 'Ctrl-g' },
  { action: 'fold', label: '折叠当前区域', key: 'Mod--' },
  { action: 'unfold', label: '展开当前区域', key: 'Mod-=' },
  { action: 'foldAll', label: '折叠所有区域', key: 'Mod-Shift--' },
  { action: 'unfoldAll', label: '展开所有区域', key: 'Mod-Shift-=' },
  { action: 'exit', label: '在代码块后继续正文', key: 'Mod-Enter' },
] as const

export function codeShortcutRows(): [string, string][] {
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
  return codeKeys.map(binding => [binding.label, (mac && 'mac' in binding ? binding.mac : binding.key).replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Backspace', '⌫').replace(/=$/, '+')])
}
