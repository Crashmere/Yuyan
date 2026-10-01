<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Ellipsis, FileText, Layers, PencilLine, Trash2, X } from 'lucide-vue-next'
import { api, errorMessage } from '../../shared/api'
import { closeTemplates, templateRequest, type ContentTemplate, type TemplateEntry } from '../../shared/templates'
import { score, units } from '../../shared/searchMatch'
import { confirm, prompt } from '../../ui/dialog'
import { toast } from '../../ui/toast'
import ActionMenu from '../../ui/ActionMenu.vue'
import type { MenuEntry } from '../../ui/menu'
import { reserveImageSpace, stopLoading } from '../../shared/images'

const request = templateRequest.value!
const entries = ref<TemplateEntry[]>([]), query = ref(''), kind = ref('all'), failure = ref(''), busy = ref(true)
const selected = ref<ContentTemplate | null>(null), selectedId = ref(''), previewBusy = ref(false), previewError = ref('')
const preview = ref<HTMLElement | null>(null)
const filtered = computed(() => entries.value.map(item => ({ item, rank: query.value.trim() ? score(item.name, units(item.pinyin), query.value) : 1 }))
  .filter(({ item, rank }) => rank > 0 && (kind.value === 'all' || item.kind === kind.value)).sort((a, b) => b.rank - a.rank).map(({ item }) => item))
async function load() {
  busy.value = true; failure.value = ''
  try { entries.value = await api('templates') } catch (e) { failure.value = errorMessage(e) }
  finally { busy.value = false }
}
onMounted(load)
let generation = 0
onBeforeUnmount(() => { generation++; if (preview.value) stopLoading(preview.value) })
async function select(item: TemplateEntry) {
  const token = ++generation
  if (preview.value) stopLoading(preview.value)
  selectedId.value = item.id; selected.value = null; previewBusy.value = true; previewError.value = ''
  try {
    const value = await api<ContentTemplate>(`templates/${item.id}`)
    if (token === generation) {
      selected.value = value
      await nextTick()
      if (token === generation && preview.value) reserveImageSpace(preview.value, value.images)
    }
  }
  catch (e) { if (token === generation) previewError.value = errorMessage(e) }
  finally { if (token === generation) previewBusy.value = false }
}
function menu(item: TemplateEntry): MenuEntry[] {
  return [
    { label: '重命名', icon: PencilLine, run: async () => {
      const name = await prompt({ title: '重命名模板或片段', value: item.name, confirmText: '保存' })
      if (!name || name === item.name) return
      await change(item, 'PATCH', name)
    } },
    { label: '删除', icon: Trash2, danger: true, run: async () => {
      if (await confirm({ title: `删除“${item.name}”？`, message: '已插入文档的内容会保留。', confirmText: '删除', danger: true })) await change(item, 'DELETE')
    } },
  ]
}
async function change(item: TemplateEntry, method: string, name?: string) {
  try {
    await api(`templates/${item.id}`, { method, json: { name, baseRevision: item.revision } })
    if (selectedId.value === item.id) { generation++; selected.value = null; selectedId.value = ''; previewBusy.value = false }
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); await load() }
}
function keydown(e: KeyboardEvent) {
  if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const index = filtered.value.findIndex(item => item.id === selectedId.value), count = filtered.value.length
    const at = index < 0 ? (e.key === 'ArrowDown' ? 0 : count - 1) : (index + (e.key === 'ArrowDown' ? 1 : count - 1)) % count
    const next = filtered.value[at]
    if (next) {
      void select(next)
      void nextTick(() => document.querySelector('.yy-template-row.active')?.scrollIntoView({ block: 'nearest' }))
    }
  } else if (e.key === 'Enter' && selected.value && e.target instanceof HTMLInputElement) { e.preventDefault(); closeTemplates(selected.value) }
}
</script>

<template>
  <DialogRoot :open="true" @update:open="open => !open && closeTemplates()">
    <DialogPortal>
      <DialogOverlay class="yy-overlay" />
      <DialogContent class="yy-dialog yy-template-dialog" :aria-describedby="undefined" @keydown="keydown">
        <div class="yy-template-heading"><DialogTitle class="yy-dialog-title">{{ request.mode === 'create' ? '从模板新建' : '插入模板或片段' }}</DialogTitle><button type="button" class="yy-icon-btn" aria-label="关闭" data-tip="关闭" @click="closeTemplates()"><X :size="18" /></button></div>
        <input v-model="query" class="yy-input" aria-label="搜索模板或片段" placeholder="搜索名称、拼音或首字母" />
        <div class="yy-link-tabs"><button v-for="tab in [{ id: 'all', name: '全部' }, { id: 'document', name: '文档模板' }, { id: 'snippet', name: '内容片段' }]" :key="tab.id" type="button" :class="{ active: kind === tab.id }" @click="kind = tab.id">{{ tab.name }}</button></div>
        <div class="yy-template-body">
          <div class="yy-template-list">
            <p v-if="busy || failure || !filtered.length" class="yy-picker-empty">{{ busy ? '正在加载…' : failure || (entries.length ? '没有匹配的内容' : '还没有模板或片段。在文档“更多操作”中保存模板，或选中内容后保存片段。') }}</p>
            <div v-for="item in filtered" :key="item.id" class="yy-template-row" :class="{ active: selectedId === item.id }">
              <button type="button" @click="select(item)"><component :is="item.kind === 'document' ? FileText : Layers" :size="17" /><span><strong>{{ item.name }}</strong><small>{{ item.snippet || (item.kind === 'document' ? '文档模板' : '内容片段') }}</small></span></button>
              <ActionMenu :items="menu(item)" content-class="yy-template-menu"><button type="button" class="yy-icon-btn" aria-label="管理模板" data-tip="管理模板"><Ellipsis :size="16" /></button></ActionMenu>
            </div>
          </div>
          <div ref="preview" class="yy-template-preview">
            <p v-if="!selected" class="yy-picker-empty">{{ previewBusy ? '正在加载预览…' : previewError || '选择一项查看内容' }}</p>
            <template v-else><h3>{{ selected.name }}</h3><div class="yy-content" @click.prevent v-html="selected.html"></div></template>
          </div>
        </div>
        <div class="yy-dialog-actions"><button type="button" class="yy-btn" @click="closeTemplates()">取消</button><button type="button" class="yy-btn primary" :disabled="!selected || previewBusy" @click="closeTemplates(selected)">{{ request.mode === 'create' ? '新建文档' : '插入内容' }}</button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
