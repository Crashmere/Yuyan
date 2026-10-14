import { Comment, Fragment, cloneVNode, type Slots, type VNode } from 'vue'

// The default slot with props merged into its first element, as reka-ui's as-child does, so a
// wrapper adds attributes and listeners without an element of its own.
export function slotChild(slots: Slots, props: Record<string, unknown>): VNode[] {
  const nodes = flatten(slots.default?.() ?? [])
  const i = nodes.findIndex((node) => node.type !== Comment)
  if (i >= 0) nodes[i] = cloneVNode(nodes[i], props)
  return nodes
}

function flatten(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) => (node.type === Fragment && Array.isArray(node.children) ? flatten(node.children as VNode[]) : [node]))
}
