<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import TouchupBar from './TouchupBar.vue'
import {
  OP_KEEP,
  OP_ERASE,
  paintDab,
  paintSegment,
  compositeTouchup,
  collectFlood,
  commitStroke,
  undoTouchup,
  redoTouchup,
  replayTouchup,
  hasEdits,
} from '../lib/touchup.js'
import { commitInpaint } from '../lib/fillStroke.js'
import { clampPan as clampPanOf, zoomAtPoint, selectionFrame } from '../lib/touchupZoom.js'

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  touch: { type: Object, required: true },
  revision: { type: Number, default: 0 },
  tolerance: { type: Number, default: 30 },
  status: { type: String, default: '' },
  error: { type: String, default: '' },
})
const emit = defineEmits(['done', 'change', 'download'])

const stageEl = ref(null)
const cv = ref(null)
const tool = ref('erase')
const radius = ref(18)
const hardnessPct = ref(80)
const alt = ref(false)
const lockedTool = ref('')
const note = ref('')
const tick = ref(0)
const cursor = reactive({ on: false, x: 0, y: 0, scale: 1 })
const zoom = ref(1)
const pan = reactive({ x: 0, y: 0 })
const spaceDown = ref(false)
const panning = ref(false)

const frameStyle = computed(() => ({
  '--w': props.width || 1,
  '--h': props.height || 1,
  aspectRatio: `${props.width || 1} / ${props.height || 1}`,
}))
const worldStyle = computed(() => ({
  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom.value})`,
}))
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const effectiveTool = computed(() => {
  if (!alt.value) return tool.value
  if (tool.value === 'erase') return 'restore'
  if (tool.value === 'restore') return 'erase'
  return 'restore'
})
const shownTool = computed(() => lockedTool.value || effectiveTool.value)
const brushing = computed(() => shownTool.value === 'erase' || shownTool.value === 'restore')
const hint = computed(() => {
  if (note.value) return note.value
  if (shownTool.value === 'fill')
    return '拖出矩形，松开后按周围颜色填上这块，适合去掉小块水印。+ − 缩放，空格拖移。'
  if (shownTool.value === 'blob') return '点击残留色块，按当前容差清掉这一块。+ − 缩放，空格拖移。'
  if (shownTool.value === 'restore')
    return '把误擦的主体涂回原图。+ − 缩放，空格拖移，Alt 临时擦除，[ ] 笔刷。'
  return '拖动直接擦掉，效果与完成后一致。+ − 缩放，空格拖移，Alt 临时还原，[ ] 笔刷。'
})
const canUndo = computed(() => {
  tick.value
  return props.touch.undo.length > 0
})
const canRedo = computed(() => {
  tick.value
  return props.touch.redo.length > 0
})
const canClear = computed(() => {
  tick.value
  return hasEdits(props.touch)
})
const cursorD = computed(() => Math.max(6, radius.value * 2 * cursor.scale))

let ctx = null
let view = null
let frame = null
let painting = false
let points = []
let strokeOp = OP_ERASE
let strokeGen = 0
let flashTimer = 0
let panOrigin = null
let selecting = false
let anchor = null
const box = reactive({ on: false, x: 0, y: 0, w: 0, h: 0 })

function redrawFull() {
  const state = props.touch
  if (!ctx || !view || !frame || !state?.auto) return
  compositeTouchup(state, view, null)
  ctx.putImageData(frame, 0, 0)
}

function blit(rect) {
  const state = props.touch
  if (!ctx || !view || !frame || !rect || rect.w <= 0 || rect.h <= 0 || !state?.auto) return
  compositeTouchup(state, view, rect)
  ctx.putImageData(frame, 0, 0, rect.x, rect.y, rect.w, rect.h)
}

function changed() {
  tick.value++
  emit('change')
}

function flash(text) {
  note.value = text
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    note.value = ''
  }, 1600)
}

function eventToImage(e) {
  const rect = cv.value?.getBoundingClientRect()
  if (!rect?.width || !rect?.height) return null
  return {
    x: ((e.clientX - rect.left) / rect.width) * props.width,
    y: ((e.clientY - rect.top) / rect.height) * props.height,
  }
}

function moveCursor(e) {
  const stage = stageEl.value?.getBoundingClientRect()
  const canvas = cv.value?.getBoundingClientRect()
  if (!stage?.width || !canvas?.width) return
  cursor.x = e.clientX - stage.left
  cursor.y = e.clientY - stage.top
  cursor.scale = canvas.width / props.width
  cursor.on = true
}

function clampPan() {
  const stage = stageEl.value
  if (!stage) return
  clampPanOf(pan, zoom.value, stage.clientWidth, stage.clientHeight)
}

function syncScale() {
  const canvas = cv.value?.getBoundingClientRect()
  if (!canvas?.width) return
  cursor.scale = canvas.width / props.width
}

function zoomAt(clientX, clientY, factor) {
  const stage = stageEl.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const next = zoomAtPoint(pan, zoom.value, clientX - rect.left, clientY - rect.top, factor)
  if (next === zoom.value) return
  zoom.value = next
  clampPan()
  nextTick(syncScale)
}

function zoomBy(factor) {
  const rect = stageEl.value?.getBoundingClientRect()
  if (!rect) return
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
}

function resetZoom() {
  zoom.value = 1
  pan.x = 0
  pan.y = 0
  nextTick(syncScale)
}

function onWheel(e) {
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1)
}

function finishStroke() {
  if (!painting) return
  painting = false
  lockedTool.value = ''
  const had = points.length > 0
  const state = props.touch
  const committed = commitStroke(state, { kind: 'brush', op: strokeOp, points })
  if (had && !committed) state.seq -= 1
  strokeGen = 0
  points = []
  if (committed) changed()
}

function addPoint(p) {
  if (!p) return
  const point = {
    x: p.x,
    y: p.y,
    radius: radius.value,
    hardness: hardnessPct.value / 100,
  }
  const state = props.touch
  if (!points.length) strokeGen = ++state.seq
  let rect
  if (!points.length) {
    rect = paintDab(state, point.x, point.y, point.radius, point.hardness, strokeOp, strokeGen)
  } else {
    const prev = points[points.length - 1]
    rect = paintSegment(
      state,
      prev.x,
      prev.y,
      point.x,
      point.y,
      point.radius,
      point.hardness,
      strokeOp,
      strokeGen
    )
  }
  points.push(point)
  blit(rect)
}

function doFlood(e) {
  const state = props.touch
  if (!view || !state?.auto) return
  const p = eventToImage(e)
  if (!p) return
  const indices = collectFlood(state.original, view, state.w, state.h, p.x, p.y, props.tolerance)
  if (!indices.length) {
    flash('这里没有还能擦掉的色块')
    return
  }
  commitStroke(state, { kind: 'flood', indices })
  replayTouchup(state)
  redrawFull()
  changed()
}

function onPointerDown(e) {
  if (e.button === 1 || (e.button === 0 && spaceDown.value)) {
    panning.value = true
    panOrigin = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    stageEl.value.setPointerCapture(e.pointerId)
    return
  }
  if (e.button != null && e.button !== 0) return
  note.value = ''
  moveCursor(e)
  if (effectiveTool.value === 'blob') {
    doFlood(e)
    return
  }
  if (effectiveTool.value === 'fill') {
    const p = eventToImage(e)
    if (!p) return
    selecting = true
    anchor = { x: p.x, y: p.y, x1: p.x, y1: p.y }
    placeBox(p.x, p.y, p.x, p.y)
    stageEl.value.setPointerCapture(e.pointerId)
    return
  }
  painting = true
  lockedTool.value = effectiveTool.value
  strokeOp = effectiveTool.value === 'restore' ? OP_KEEP : OP_ERASE
  points = []
  stageEl.value.setPointerCapture(e.pointerId)
  addPoint(eventToImage(e))
}

function onPointerMove(e) {
  moveCursor(e)
  if (panning.value && panOrigin) {
    pan.x = panOrigin.px + (e.clientX - panOrigin.x)
    pan.y = panOrigin.py + (e.clientY - panOrigin.y)
    clampPan()
    return
  }
  if (selecting && anchor) {
    const p = eventToImage(e)
    if (!p) return
    anchor.x1 = p.x
    anchor.y1 = p.y
    placeBox(anchor.x, anchor.y, p.x, p.y)
    return
  }
  if (!painting) return
  addPoint(eventToImage(e))
}

function onPointerUp() {
  if (panning.value) {
    panning.value = false
    panOrigin = null
    return
  }
  if (selecting) {
    finishFill()
    return
  }
  finishStroke()
}

function onPointerLeave() {
  if (!painting) cursor.on = false
}

function doUndo() {
  if (painting) {
    painting = false
    lockedTool.value = ''
    points = []
    replayTouchup(props.touch)
    redrawFull()
    return
  }
  if (!undoTouchup(props.touch)) return
  redrawFull()
  changed()
}

function doRedo() {
  if (painting) return
  if (!redoTouchup(props.touch)) return
  redrawFull()
  changed()
}

function placeBox(x0, y0, x1, y1) {
  const canvas = cv.value?.getBoundingClientRect()
  const stage = stageEl.value?.getBoundingClientRect()
  if (!canvas?.width || !stage) return
  Object.assign(box, selectionFrame(canvas, stage, props.width, props.height, x0, y0, x1, y1), {
    on: true,
  })
}

function finishFill() {
  if (!selecting) return
  selecting = false
  box.on = false
  const start = anchor
  anchor = null
  if (!start || !view) return
  const message = commitInpaint(props.touch, view, start.x, start.y, start.x1, start.y1)
  if (message) {
    flash(message)
    return
  }
  redrawFull()
  changed()
}

function doReset() {
  if (painting || selecting || !hasEdits(props.touch)) return
  commitStroke(props.touch, { kind: 'reset' })
  replayTouchup(props.touch)
  redrawFull()
  changed()
}

function nudgeRadius(dir, shift) {
  const step = shift ? 8 : 2
  radius.value = Math.min(120, Math.max(1, radius.value + dir * step))
}

function onKeyTarget(e) {
  const el = e.target
  return el instanceof Element && !!el.closest('input, textarea, button, select')
}

function onKeyDown(e) {
  if (e.key === 'Alt') {
    e.preventDefault()
    alt.value = true
    return
  }
  if (e.code === 'Space') {
    if (!onKeyTarget(e)) {
      e.preventDefault()
      spaceDown.value = true
    }
    return
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      e.preventDefault()
      zoomBy(1.25)
      return
    }
    if (e.key === '-' || e.code === 'NumpadSubtract') {
      e.preventDefault()
      zoomBy(1 / 1.25)
      return
    }
  }
  if (e.key === '[' || e.key === ']') {
    e.preventDefault()
    nudgeRadius(e.key === ']' ? 1 : -1, e.shiftKey)
    return
  }
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return
  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault()
    if (e.shiftKey) doRedo()
    else doUndo()
  } else if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    doRedo()
  }
}

function onKeyUp(e) {
  if (e.key === 'Alt') alt.value = false
  if (e.code === 'Space') spaceDown.value = false
}

function onBlur() {
  alt.value = false
  spaceDown.value = false
}

watch(
  () => props.revision,
  () => redrawFull()
)

onMounted(() => {
  const canvas = cv.value
  const w = props.width
  const h = props.height
  if (!canvas || !w || !h) return
  canvas.width = w
  canvas.height = h
  ctx = canvas.getContext('2d')
  view = new Uint8ClampedArray(w * h * 4)
  frame = new ImageData(view, w, h)
  redrawFull()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
})

onBeforeUnmount(() => {
  finishFill()
  finishStroke()
  clearTimeout(flashTimer)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onBlur)
})
</script>

<template>
  <div class="touch">
    <div
      ref="stageEl"
      class="stage"
      :class="{ blob: !brushing, space: spaceDown, panning }"
      :style="frameStyle"
      role="application"
      aria-label="修边画布"
      @pointerdown.prevent="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @wheel.prevent="onWheel"
      @contextmenu.prevent
    >
      <div class="world" :style="worldStyle">
        <canvas ref="cv"></canvas>
      </div>
      <span
        v-if="box.on"
        class="marquee"
        :style="{
          left: box.x + 'px',
          top: box.y + 'px',
          width: box.w + 'px',
          height: box.h + 'px',
        }"
      ></span>
      <span
        v-show="cursor.on && brushing && !spaceDown && !panning"
        class="ring"
        :class="shownTool"
        :style="{
          left: cursor.x + 'px',
          top: cursor.y + 'px',
          width: cursorD + 'px',
          height: cursorD + 'px',
        }"
      ></span>
      <span v-if="status === 'processing'" class="chip"><i></i>重新处理中</span>
      <span v-else-if="status === 'error'" class="chip err">{{ error || '处理失败' }}</span>
    </div>

    <p class="hint" :class="{ warn: !!note }">{{ hint }}</p>

    <TouchupBar
      :tool="tool"
      :radius="radius"
      :hardness="hardnessPct"
      :zoom-label="zoomLabel"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :can-clear="canClear"
      :can-download="!!touch.auto"
      @update:tool="tool = $event"
      @update:radius="radius = $event"
      @update:hardness="hardnessPct = $event"
      @zoom-in="zoomBy(1.25)"
      @zoom-out="zoomBy(1 / 1.25)"
      @zoom-reset="resetZoom"
      @undo="doUndo"
      @redo="doRedo"
      @clear="doReset"
      @download="emit('download')"
      @done="emit('done')"
    />
  </div>
</template>

<style scoped>
.touch {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.stage {
  position: relative;
  align-self: center;
  width: min(calc(100% - 36px), calc(min(64vh, 640px) * var(--w) / var(--h)));
  margin: 18px auto 0;
  border-radius: 12px;
  overflow: hidden;
  cursor: none;
  user-select: none;
  touch-action: none;
  background: repeating-conic-gradient(#eef0f5 0% 25%, #ffffff 0% 50%) 0 0 / 20px 20px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
}
.stage.blob:not(.space):not(.panning) {
  cursor: crosshair;
}
.stage.space {
  cursor: grab;
}
.stage.panning {
  cursor: grabbing;
}
.world {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  pointer-events: none;
}
canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.marquee {
  position: absolute;
  border: 1.5px solid #fff;
  outline: 1px solid #6366f1;
  background: rgba(99, 102, 241, 0.2);
  pointer-events: none;
}
.ring {
  position: absolute;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1.5px solid #fff;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}
.ring.restore {
  border-color: #c7d2fe;
  box-shadow:
    0 0 0 1.5px #6366f1,
    inset 0 0 0 1px rgba(99, 102, 241, 0.45);
}
.chip {
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
.chip i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.5px solid #fff;
  border-top-color: transparent;
  animation: spin 0.7s linear infinite;
}
.chip.err {
  background: rgba(239, 68, 68, 0.92);
}
.hint {
  margin: 12px 18px;
  font-size: 13px;
  color: #4b5265;
  background: #f4f6fb;
  border: 1px solid #e6e9f2;
  padding: 7px 12px;
  border-radius: 9px;
}
.hint.warn {
  color: #b45309;
  background: #fffbeb;
  border-color: #fde68a;
}
</style>
