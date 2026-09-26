<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, Ellipsis, Plus } from 'lucide-vue-next'
import type { TreeNode } from '../../shared/api'
import ActionMenu from '../../ui/ActionMenu.vue'
import ContextActions from '../../ui/ContextActions.vue'
import IconButton from '../../ui/IconButton.vue'
import { newDoc } from '../actions'
import { treeKey } from './context'

defineOptions({ name: 'TreeItem' })
const props = defineProps<{ node: TreeNode; depth: number }>()
const tree = inject(treeKey)!
const router = useRouter()

const hasChildren = computed(() => !!props.node.children?.length)
const open = computed(() => tree.isOpen(props.node.id))
const current = computed(() => tree.currentId() === props.node.id)
const renaming = computed(() => tree.renaming.value === props.node.id)
const items = computed(() => tree.menu(props.node))
const drop = computed(() => (tree.drag.overId === props.node.id && tree.drag.position ? `drop-${tree.drag.position}` : ''))
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

function activate() {
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
  <li class="yy-tree-item" role="treeitem" :aria-expanded="hasChildren ? open : undefined" :aria-selected="current">
    <ContextActions :items="items" @open="(v) => (contextOpen = v)">
      <div
        class="yy-tree-row"
        :class="[node.kind, drop, { current, active: menuOpen || contextOpen, dragging: tree.drag.id === node.id }]"
        :style="{ '--depth': depth }"
        :data-tree-id="node.id"
        :draggable="!renaming"
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
        <a v-else-if="node.kind === 'doc'" class="yy-tree-title" :href="href" draggable="false" :title="node.title" @click="onTitleClick">{{ node.title }}</a>
        <span v-else class="yy-tree-title" :title="node.title">{{ node.title }}</span>
        <span v-if="!renaming" class="yy-tree-actions" @click.stop>
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
