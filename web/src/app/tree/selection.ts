import { computed, reactive, ref, watch } from 'vue'
import type { TreeNode } from '../../shared/api'

export function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])])
}

export function useTreeSelection(nodes: () => TreeNode[], isOpen: (id: number) => boolean) {
  const active = ref(false), selected = reactive(new Set<number>())
  let anchor: number | null = null
  const all = computed(() => flatten(nodes()))
  const selectedNodes = computed(() => all.value.filter((n) => selected.has(n.id)))
  const roots = computed(() => selectedNodes.value.filter((n) => n.parentId == null || !selected.has(n.parentId)))
  const allState = computed(() => !selected.size ? false : selected.size === all.value.length ? true : 'mixed')
  const state = (n: TreeNode): boolean | 'mixed' => selected.has(n.id) ? true
    : flatten(n.children ?? []).some((c) => selected.has(c.id)) ? 'mixed' : false
  function setSubtree(n: TreeNode, checked: boolean) {
    for (const child of flatten([n])) { if (checked) selected.add(child.id); else selected.delete(child.id) }
  }
  function reconcileParents() {
    // A selected parent always means its whole subtree. Removing a child deselects
    // its ancestors, so a later move/delete cannot touch that excluded child.
    for (const n of [...all.value].reverse()) {
      if (selected.has(n.id) && n.children?.some((c) => !selected.has(c.id))) selected.delete(n.id)
    }
  }
  function toggle(n: TreeNode, range = false) {
    const checked = state(n) !== true
    const visible: TreeNode[] = []
    const walk = (ns: TreeNode[]) => { for (const item of ns) { visible.push(item); if (isOpen(item.id)) walk(item.children ?? []) } }
    walk(nodes())
    const a = visible.findIndex((item) => item.id === anchor), b = visible.findIndex((item) => item.id === n.id)
    for (const item of range && a >= 0 && b >= 0 ? visible.slice(Math.min(a, b), Math.max(a, b) + 1) : [n]) setSubtree(item, checked)
    reconcileParents()
    anchor = n.id
  }
  function selectAll() {
    if (allState.value === true) selected.clear()
    else for (const n of all.value) selected.add(n.id)
    anchor = null
  }
  function exit() { active.value = false; selected.clear(); anchor = null }
  watch(nodes, () => {
    const alive = new Set(all.value.map((n) => n.id))
    for (const id of selected) if (!alive.has(id)) selected.delete(id)
    reconcileParents()
  })
  return { active, selected, selectedNodes, roots, allState, state, toggle, selectAll, exit }
}
