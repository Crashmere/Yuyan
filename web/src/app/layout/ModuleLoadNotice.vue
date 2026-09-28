<script setup lang="ts">
import { ref } from 'vue'
import { moduleLoadFailed, moduleReloadGuard, moduleReloadURL } from '../../shared/moduleLoad'

const busy = ref(false)
const failed = ref(false)
async function reload() {
  if (busy.value) return
  busy.value = true
  failed.value = false
  const guard = moduleReloadGuard.value
  const href = location.href
  try {
    if (guard && !(await guard())) {
      failed.value = true
      return
    }
    // The user may navigate while an upload or save is pending.
    if (moduleReloadGuard.value !== guard || location.href !== href) return
    if (moduleReloadURL.value) location.assign(moduleReloadURL.value)
    else location.reload()
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="moduleLoadFailed" class="yy-banner yy-module-notice" role="alert">
    <span>{{ failed ? '修改尚未保存，已保留当前页面。请先处理保存问题，再重试。' : '部分功能加载失败，可能是页面版本已更新或网络中断。请刷新后重试。' }}</span>
    <button type="button" class="yy-btn small" :disabled="busy" @click="reload">{{ busy ? '正在保存…' : moduleReloadGuard ? '保存并刷新' : '刷新页面' }}</button>
  </div>
</template>
