<script setup>
import { computed } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  color: { type: String, default: '' },
})

/** 贴在光标右下方；靠近窗口边缘时翻到另一侧，避免被裁切。 */
const style = computed(() => {
  const width = 108
  const height = 36
  const gap = 16
  let left = props.x + 18
  let top = props.y + 18
  if (left + width > window.innerWidth - gap) left = props.x - width - 12
  if (top + height > window.innerHeight - gap) top = props.y - height - 12
  return { left: `${left}px`, top: `${top}px` }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show && color" class="loupe" :style="style">
      <i :style="{ background: color }"></i>
      <span>{{ color }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.loupe {
  position: fixed;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 6px;
  border-radius: 10px;
  background: rgba(17, 24, 39, 0.9);
  color: #fff;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}
.loupe i {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
</style>
