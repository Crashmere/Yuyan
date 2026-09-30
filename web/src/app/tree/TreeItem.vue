<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, Ellipsis, Plus } from 'lucide-vue-next'
import type { TreeNode } from '../../shared/api'
import ActionMenu from '../../ui/ActionMenu.vue'
import ContextActions from '../../ui/ContextActions.vue'
import IconButton from '../../ui/IconButton.vue'
import { newDoc } from '../actions'
import { dropsIntoNode, treeKey } from './context'

defineOptions({ name: 'TreeItem' })
const props = defineProps<{ node: TreeNode; depth: number }>()
const tree = inject(treeKey)!
const router = useRouter()

const hasChildren = computed(() => !!props.node.children?.length)
const open = computed(() => tree.isOpen(props.node.id))
const current = computed(() => tree.currentId() === props.node.id)
const selecting = computed(() => tree.selecting())
const selected = computed(() => tree.selectionState(props.node))
const renaming = computed(() => tree.renaming.value === props.node.id)
const items = computed(() => tree.menu(props.node))
const drop = computed(() => (tree.drag.overId === props.node.id && tree.drag.position ? `drop-${tree.drag.position}` : ''))
const dropDepth = computed(() => props.depth + (dropsIntoNode(props.node, tree.drag.position, open.value) ? 1 : 0))
const href = computed(() => router.resolve(`/docs/${props.node.id}`).href)
const menuOpen = ref(false)
const contextOpen = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

watch(renaming, async (r) => {
  if (!r) return
  draft.value = props.node.title
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function activate(e: MouseEvent) {
  if (selecting.value) { tree.select(props.node, e.shiftKey); return }
  if (renaming.value) return
  if (props.node.kind === 'group') tree.toggle(props.node.id)
  else void router.push(`/docs/${props.node.id}`)
}

// Modified clicks keep the browser's own handling, such as opening the document in a new tab.
function onTitleClick(e: MouseEvent) {
  if (e.metaKey || e.ctrlKey || e.shiftKey) e.stopPropagation()
  else e.preventDefault()
}
</script>

<template>
  <li class="yy-tree-item" role="treeitem" :aria-expanded="hasChildren ? open : undefined" :aria-selected="selecting ? selected === true : current" :aria-checked="selecting ? selected : undefined">
    <ContextActions :items="items" :disabled="selecting" @open="(v) => (contextOpen = v)">
      <div
        class="yy-tree-row"
        :class="[node.kind, drop, { current, selecting, checked: selecting && selected === true, active: menuOpen || contextOpen, dragging: tree.drag.id === node.id }]"
        :style="{ '--depth': depth, '--drop-depth': dropDepth }"
        :data-tree-id="node.id"
        :draggable="!renaming && !selecting"
        @click="activate"
        @dragstart="tree.onDragStart(node, $event)"
        @dragover="tree.onDragOver(node, $event)"
        @drop="tree.onDrop(node, $event)"
        @dragend="tree.onDragEnd()"
      >
        <button v-if="hasChildren" type="button" class="yy-tree-caret" :class="{ open }" :aria-label="open ? '收起' : '展开'" @click.stop="tree.toggle(node.id)">
          <ChevronRight :size="14" />
        </button>
        <span v-else class="yy-tree-caret"></span>
        <input v-if="selecting" type="checkbox" class="yy-tree-check" :checked="selected === true" :indeterminate="selected === 'mixed'"
          :aria-label="`选择 ${node.title}`" :disabled="tree.busy()" @click.stop="tree.select(node, $event.shiftKey)" />
        <input
          v-if="renaming"
          ref="input"
          v-model="draft"
          class="yy-tree-input"
          aria-label="新的标题"
          @click.stop
          @keydown.enter.prevent="($event.isComposing || tree.finishRename(node, draft))"
          @keydown.esc.prevent="tree.finishRename(node, null)"
          @blur="tree.finishRename(node, draft)"
        />
        <a v-else-if="node.kind === 'doc' && !selecting" class="yy-tree-title" :href="href" draggable="false" :title="node.title" @click="onTitleClick">{{ node.title }}</a>
        <span v-else class="yy-tree-title" :class="{ 'yy-directory-title': node.kind === 'group' }" :title="node.title">{{ node.title }}</span>
        <span v-if="!renaming && !selecting" class="yy-tree-actions" @click.stop>
          <ActionMenu v-model:open="menuOpen" :items="items">
            <IconButton small label="更多操作" :tooltip="false"><Ellipsis :size="15" /></IconButton>
          </ActionMenu>
          <IconButton small label="新建子文档" :tooltip="false" @click="newDoc(tree.bookId, node.id)"><Plus :size="15" /></IconButton>
        </span>
      </div>
    </ContextActions>
    <ul v-if="hasChildren && open" class="yy-tree-children" role="group">
      <TreeItem v-for="c in node.children" :key="c.id" :node="c" :depth="depth + 1" />
    </ul>
  </li>
</template>
