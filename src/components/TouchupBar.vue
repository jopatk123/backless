<script setup>
defineProps({
  tool: { type: String, required: true },
  radius: { type: Number, required: true },
  hardness: { type: Number, required: true },
  zoomLabel: { type: String, required: true },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
  canClear: { type: Boolean, default: false },
  canDownload: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:tool',
  'update:radius',
  'update:hardness',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'undo',
  'redo',
  'clear',
  'download',
  'done',
])
</script>

<template>
  <footer class="bar">
    <div class="modes" role="tablist" @mousedown.prevent>
      <button type="button" :class="{ on: tool === 'erase' }" @click="emit('update:tool', 'erase')">
        擦除
      </button>
      <button
        type="button"
        :class="{ on: tool === 'restore' }"
        @click="emit('update:tool', 'restore')"
      >
        还原
      </button>
      <button type="button" :class="{ on: tool === 'blob' }" @click="emit('update:tool', 'blob')">
        擦这块
      </button>
      <button type="button" :class="{ on: tool === 'fill' }" @click="emit('update:tool', 'fill')">
        填充
      </button>
    </div>

    <div class="zoom" @mousedown.prevent>
      <button type="button" title="缩小 (-)" @click="emit('zoom-out')">−</button>
      <button type="button" class="zoom-label" title="恢复适应画面" @click="emit('zoom-reset')">
        {{ zoomLabel }}
      </button>
      <button type="button" title="放大 (+)" @click="emit('zoom-in')">+</button>
    </div>

    <template v-if="tool !== 'fill'">
      <label class="slider">
        <span>笔刷</span>
        <input
          :value="radius"
          type="range"
          min="1"
          max="64"
          step="1"
          :style="{ '--fill': ((radius - 1) / 63) * 100 + '%' }"
          @input="emit('update:radius', Number($event.target.value))"
        />
        <em>{{ radius }}</em>
      </label>
      <label class="slider">
        <span>硬度</span>
        <input
          :value="hardness"
          type="range"
          min="0"
          max="100"
          step="1"
          :style="{ '--fill': hardness + '%' }"
          @input="emit('update:hardness', Number($event.target.value))"
        />
        <em>{{ hardness }}</em>
      </label>
    </template>

    <div class="right" @mousedown.prevent>
      <button type="button" class="btn ghost xs" :disabled="!canUndo" @click="emit('undo')">
        撤销
      </button>
      <button type="button" class="btn ghost xs" :disabled="!canRedo" @click="emit('redo')">
        重做
      </button>
      <button type="button" class="btn ghost xs" :disabled="!canClear" @click="emit('clear')">
        清除
      </button>
      <button type="button" class="btn ghost" :disabled="!canDownload" @click="emit('download')">
        下载 PNG
      </button>
      <button type="button" class="btn primary" title="完成修边 (Esc)" @click="emit('done')">
        完成
      </button>
    </div>
  </footer>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-top: 1px solid #eef0f6;
  background: #fafbfe;
}
.modes,
.zoom {
  display: flex;
  align-items: center;
  background: #eef0f6;
  border-radius: 10px;
  padding: 3px;
}
.modes button,
.zoom button {
  border: none;
  background: transparent;
  color: #6b7280;
  border-radius: 8px;
  cursor: pointer;
}
.modes button {
  font-size: 13px;
  padding: 5px 12px;
}
.zoom button {
  min-width: 28px;
  height: 28px;
  font-size: 15px;
  font-weight: 650;
  color: #4b5265;
}
.modes button.on,
.zoom button:hover {
  background: #fff;
  color: var(--text);
}
.modes button.on {
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}
.zoom button:hover {
  color: var(--accent);
}
.zoom-label {
  min-width: 52px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.slider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #4b5265;
}
.slider input {
  width: 96px;
}
.slider em {
  font-style: normal;
  font-size: 12px;
  font-weight: 650;
  color: var(--accent);
  min-width: 22px;
  font-variant-numeric: tabular-nums;
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
