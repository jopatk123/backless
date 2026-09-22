<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  image: { type: Object, required: true },
})
const emit = defineEmits(['close', 'pick', 'reset-color', 'download'])

const mode = ref('compare') // compare | result | original
const pos = ref(50) // 对比分隔线位置（百分比）
const picking = ref(false)
const viewportEl = ref(null)
const modeBeforePick = ref('compare')

let dragging = false

const hasResult = computed(() => !!props.image.resultUrl)
const split = computed(() => mode.value === 'compare' && hasResult.value)
const frameStyle = computed(() => {
  const w = props.image.width || 1
  const h = props.image.height || 1
  return { '--w': w, '--h': h, aspectRatio: `${w} / ${h}` }
})
const resultClip = computed(() => ({ clipPath: `inset(0 ${100 - pos.value}% 0 0)` }))
const originalClip = computed(() => ({ clipPath: `inset(0 0 0 ${pos.value}%)` }))

const autoHex = computed(() => toHex(props.image.autoColor))
const pickedHex = computed(() => toHex(props.image.pickedColor))

function toHex(c) {
  if (!c) return ''
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

function updatePos(e) {
  const rect = viewportEl.value?.getBoundingClientRect()
  if (!rect?.width) return
  pos.value = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
}

function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  if (picking.value) {
    doPick(e)
    return
  }
  if (!split.value) return
  dragging = true
  viewportEl.value.setPointerCapture(e.pointerId)
  updatePos(e)
}
function onPointerMove(e) {
  if (dragging) updatePos(e)
}
function onPointerUp() {
  dragging = false
}

/** 把点击位置换算成原图像素坐标。视口与图片等比，可直接按比例映射。 */
function eventToPixel(e) {
  const el = viewportEl.value
  const w = props.image.width
  const h = props.image.height
  if (!el || !w || !h) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: Math.min(w - 1, Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * w))),
    y: Math.min(h - 1, Math.max(0, Math.round(((e.clientY - rect.top) / rect.height) * h))),
  }
}

function doPick(e) {
  const pt = eventToPixel(e)
  picking.value = false
  mode.value = 'compare'
  if (pt) emit('pick', pt.x, pt.y)
}

function startPick() {
  if (!picking.value) modeBeforePick.value = mode.value
  picking.value = true
  mode.value = 'original'
}

function cancelPick() {
  picking.value = false
  mode.value = modeBeforePick.value
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    if (picking.value) cancelPick()
    else emit('close')
    return
  }
  if (!split.value || picking.value) return
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 2
    pos.value = Math.min(100, Math.max(0, pos.value + (e.key === 'ArrowLeft' ? -step : step)))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.classList.add('modal-open')
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.classList.remove('modal-open')
})
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="modal">
      <header class="m-head">
        <div class="m-title">
          <strong :title="image.name">{{ image.name }}</strong>
          <span>{{ image.width }}×{{ image.height }} px</span>
        </div>
        <button class="icon-btn" title="关闭 (Esc)" @click="emit('close')">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div
        ref="viewportEl"
        class="viewport"
        :class="{ picking, comparing: split }"
        :style="frameStyle"
        @pointerdown.prevent="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <!-- 原图与结果分开裁切，透明区域露出棋盘格，而不是透出原图 -->
        <img
          v-show="mode !== 'result'"
          class="layer"
          :src="image.originalUrl"
          alt=""
          draggable="false"
          :style="split ? originalClip : null"
        />
        <img
          v-show="mode !== 'original' && hasResult"
          class="layer"
          :src="image.resultUrl"
          alt=""
          draggable="false"
          :style="split ? resultClip : null"
        />
        <template v-if="split">
          <div class="divider" :style="{ left: pos + '%' }">
            <span class="handle">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 7l-4 5 4 5M15 7l4 5-4 5" />
              </svg>
            </span>
          </div>
          <span class="tag left">抠图后</span>
          <span class="tag right">原图</span>
        </template>
        <span v-else class="tag" :class="mode === 'result' ? 'left' : 'right'">
          {{ mode === 'result' ? '抠图结果 · 透明底' : '原图' }}
        </span>
        <span v-if="image.status === 'processing'" class="m-loading"><i></i>重新处理中</span>
        <span v-if="image.status === 'error'" class="m-err">{{ image.error || '处理失败' }}</span>
      </div>

      <p v-if="picking" class="pick-hint">点击图片中要去除的颜色（基于原图取样）</p>

      <footer class="m-foot">
        <div class="modes" role="tablist">
          <button :class="{ on: mode === 'original' }" @click="mode = 'original'">原图</button>
          <button :class="{ on: mode === 'compare' }" @click="mode = 'compare'">对比</button>
          <button :class="{ on: mode === 'result' }" @click="mode = 'result'">结果</button>
        </div>

        <div class="colors">
          <span class="swatch" :title="`自动识别 ${autoHex}`">
            <i :style="{ background: autoHex }"></i>自动
          </span>
          <span v-if="image.pickedColor" class="swatch picked" :title="`手动吸取 ${pickedHex}`">
            <i :style="{ background: pickedHex }"></i>手动
          </span>
          <button v-if="image.pickedColor" class="btn ghost xs" @click="emit('reset-color')">
            恢复自动
          </button>
        </div>

        <div class="foot-right">
          <button
            class="btn ghost"
            :class="{ active: picking }"
            @click="picking ? cancelPick() : startPick()"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            >
              <path d="M13 3 7 9l-3.5 8.5L12 12zM10 20h11" />
              <path d="m13 3 4 4" />
            </svg>
            {{ picking ? '取消吸色' : '吸取背景色' }}
          </button>
          <button class="btn primary" :disabled="!image.resultBlob" @click="emit('download')">
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16" />
            </svg>
            下载 PNG
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 18, 34, 0.55);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: fade 0.2s ease;
}
.modal {
  width: min(860px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 30px 80px -20px rgba(2, 6, 23, 0.45);
  animation: pop 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  overflow: auto;
}
.m-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #eef0f6;
}
.m-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.m-title strong {
  font-size: 15px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 440px;
}
.m-title span {
  font-size: 12.5px;
  color: var(--muted);
  white-space: nowrap;
}
.icon-btn {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s;
}
.icon-btn:hover {
  background: #f1f2f7;
  color: var(--text);
}

.viewport {
  position: relative;
  align-self: center;
  width: min(calc(100% - 36px), calc(min(64vh, 640px) * var(--w) / var(--h)));
  margin: 18px auto;
  flex: none;
  border-radius: 12px;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  background: repeating-conic-gradient(#eef0f5 0% 25%, #ffffff 0% 50%) 0 0 / 20px 20px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
}
.viewport.comparing {
  cursor: ew-resize;
}
.viewport.picking {
  cursor: crosshair;
}
.layer {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  -webkit-user-drag: none;
}
.divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  background: #fff;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.55);
}
.tag {
  position: absolute;
  top: 12px;
  font-size: 12px;
  color: #fff;
  background: rgba(17, 24, 39, 0.62);
  backdrop-filter: blur(4px);
  padding: 4px 12px;
  border-radius: 999px;
  pointer-events: none;
}
.tag.left {
  left: 12px;
}
.tag.right {
  right: 12px;
}
.m-loading {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: #fff;
  background: rgba(99, 102, 241, 0.9);
  padding: 5px 14px;
  border-radius: 999px;
  pointer-events: none;
}
.m-loading i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.5px solid #fff;
  border-top-color: transparent;
  animation: spin 0.7s linear infinite;
}
.m-err {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  font-size: 12.5px;
  color: #fff;
  background: rgba(239, 68, 68, 0.92);
  padding: 5px 14px;
  border-radius: 999px;
}
.pick-hint {
  margin: 0 18px 12px;
  font-size: 13px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  padding: 7px 12px;
  border-radius: 9px;
  animation: fade 0.2s ease;
}
.m-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-top: 1px solid #eef0f6;
  background: #fafbfe;
}
.modes {
  display: flex;
  background: #eef0f6;
  border-radius: 10px;
  padding: 3px;
}
.modes button {
  border: none;
  background: transparent;
  font-size: 13px;
  color: #6b7280;
  padding: 5px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s;
}
.modes button.on {
  background: #fff;
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}
.colors {
  display: flex;
  align-items: center;
  gap: 8px;
}
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--muted);
}
.swatch i {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  display: inline-block;
}
.swatch.picked {
  color: var(--accent);
  font-weight: 600;
}
.foot-right {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
</style>
