<script setup lang="ts">
import { computed } from 'vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'
import { calloutTypes } from '../../schema/callout'
import { calloutMeta } from '../callouts'

// The callout type (with its colour and icon) and whether reading pages can fold it.
const props = defineProps<{ type: string; fold: string }>()
const emit = defineEmits<{ type: [string]; fold: [string] }>()

const current = computed(() => calloutMeta(props.type))
const folds = [
  { value: '', label: '不折叠' },
  { value: '+', label: '可折叠，默认展开' },
  { value: '-', label: '可折叠，默认折叠' },
]
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger class="yy-callout-trigger" aria-label="Callout 类型与折叠方式">
      <component :is="current.icon" :size="14" />{{ current.label }}<ChevronDown :size="12" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="yy-menu yy-callout-menu" align="end" :side-offset="4" @close-auto-focus.prevent>
        <DropdownMenuLabel class="yy-menu-label">类型</DropdownMenuLabel>
        <div class="yy-callout-types">
          <DropdownMenuItem
            v-for="t in calloutTypes"
            :key="t"
            class="yy-callout-type"
            :class="{ active: t === type }"
            :style="{ '--callout-color': calloutMeta(t).color }"
            @select="emit('type', t)"
          >
            <span class="yy-callout-swatch"><component :is="calloutMeta(t).icon" :size="14" /></span>
            <span>{{ calloutMeta(t).label }}</span>
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator class="yy-menu-sep" />
        <DropdownMenuLabel class="yy-menu-label">折叠（阅读页）</DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="fold" @update:model-value="(v) => emit('fold', String(v))">
          <DropdownMenuRadioItem v-for="f in folds" :key="f.value" :value="f.value" class="yy-menu-item">
            {{ f.label }}<Check v-if="f.value === fold" :size="15" class="yy-menu-check" />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
