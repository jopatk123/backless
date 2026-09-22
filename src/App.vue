<script setup>
import { ref, reactive, computed, markRaw, onMounted, onBeforeUnmount } from 'vue'
import JSZip from 'jszip'
import Dropzone from './components/Dropzone.vue'
import ImageCard from './components/ImageCard.vue'
import CompareModal from './components/CompareModal.vue'
import { createMattingService } from './lib/mattingService.js'
import { createTouchup, compositeTouchup, hasEdits } from './lib/touchup.js'

const service = createMattingService()
const images = reactive([])
const settings = reactive({ tolerance: 30, feather: 1 })
const isDraggingOver = ref(false)
const zipBusy = ref(false)
const modalId = ref(null)
const fileInput = ref(null)

const modalImage = computed(() => images.find((i) => i.id === modalId.value) || null)
const readyCount = computed(() => images.filter((i) => i.resultBlob).length)

let uid = 0
let reprocessTimer = null
// 每张图只采纳最后一次处理结果，避免旧请求把新结果盖掉
const processGen = new WeakMap()
const publishGen = new WeakMap()
// 复用一个解码用 canvas
const decodeCanvas = document.createElement('canvas')
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true })

function errorText(e) {
  const msg = e && e.message
  if (msg && msg.length <= 30 && !/postMessage|could not be cloned|Failed to execute/i.test(msg))
    return msg
  return '处理失败'
}

/* ---------------- 上传与注册 ---------------- */

function isImageFile(file) {
  if (!file) return false
  if (file.type && file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name || '')
}

async function addFiles(fileList) {
  const files = [...fileList].filter(isImageFile)
  for (const file of files) {
    const id = ++uid
    const rec = reactive({
      id,
      name: file.name,
      size: file.size,
      width: 0,
      height: 0,
      status: 'loading',
      error: '',
      originalUrl: URL.createObjectURL(file),
      resultUrl: '',
      resultBlob: null,
      override: null,
      pickedColor: null,
      autoColor: null,
      touch: null,
      touchRev: 0,
      edited: false,
    })
    images.push(rec)
    // 解码失败与后台线程通信失败分开提示，避免误报「无法解码」
    let imageData
    try {
      const bitmap = await createImageBitmap(file)
      decodeCanvas.width = bitmap.width
      decodeCanvas.height = bitmap.height
      decodeCtx.drawImage(bitmap, 0, 0)
      bitmap.close()
      imageData = decodeCtx.getImageData(0, 0, decodeCanvas.width, decodeCanvas.height)
    } catch {
      rec.status = 'error'
      rec.error = '无法解码该图片'
      continue
    }
    rec.width = imageData.width
    rec.height = imageData.height
    rec.touch = markRaw(createTouchup(new Uint8ClampedArray(imageData.data), rec.width, rec.height))
    try {
      rec.autoColor = await service.register(id, imageData)
      rec.status = 'processing'
      await runProcess(rec)
    } catch (e) {
      rec.status = 'error'
      rec.error = errorText(e)
    }
  }
}

function onFileChange(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

/* ---------------- 抠图处理 ---------------- */

async function runProcess(rec) {
  const token = (processGen.get(rec) || 0) + 1
  processGen.set(rec, token)
  const stale = () => processGen.get(rec) !== token || !images.includes(rec)
  try {
    const { buffer, w, h } = await service.process(rec.id, {
      tolerance: rec.override?.tolerance ?? settings.tolerance,
      feather: rec.override?.feather ?? settings.feather,
      pickedColor: rec.pickedColor,
    })
    if (stale()) return
    if (!buffer || buffer.byteLength !== w * h * 4) throw new Error('结果数据异常')
    if (!rec.touch || rec.touch.w !== w || rec.touch.h !== h) throw new Error('结果数据异常')
    rec.touch.auto = new Uint8ClampedArray(buffer)
    rec.touchRev++
    await publishComposite(rec)
  } catch (e) {
    if (stale()) return
    rec.status = 'error'
    rec.error = errorText(e)
  }
}

function processAll() {
  images.forEach((rec) => {
    // 已单独设置参数的图片不受全局设置影响
    if (rec.autoColor && rec.status !== 'loading' && !rec.override) {
      rec.status = 'processing'
      runProcess(rec)
    }
  })
}

function onSettingsChange() {
  clearTimeout(reprocessTimer)
  reprocessTimer = setTimeout(processAll, 260)
}

/* ---------------- 单图参数覆盖 ---------------- */

let overrideTimer = null

/** 设置或清除单图参数覆盖；与全局设置同样先防抖再重处理该图。 */
function setOverride(rec, value) {
  if (!rec) return
  clearTimeout(overrideTimer)
  overrideTimer = setTimeout(() => {
    if (!images.includes(rec)) return
    rec.override = value ? { tolerance: value.tolerance, feather: value.feather } : null
    if (rec.autoColor) {
      rec.status = 'processing'
      runProcess(rec)
    }
  }, 260)
}

/* ---------------- 吸色 ---------------- */

async function pickColor(rec, x, y) {
  if (!rec) return
  const seen = processGen.get(rec) || 0
  try {
    const color = await service.sample(rec.id, x, y)
    // 取样返回前若已点了「恢复自动」或改了参数，丢弃这次吸色
    if (!images.includes(rec) || (processGen.get(rec) || 0) !== seen) return
    if (!color) throw new Error('吸色失败')
    rec.pickedColor = [color[0], color[1], color[2]]
    rec.status = 'processing'
    await runProcess(rec)
  } catch (e) {
    if (!images.includes(rec) || (processGen.get(rec) || 0) !== seen) return
    rec.status = 'error'
    rec.error = errorText(e)
  }
}

function compositePixels(rec) {
  const { w, h } = rec.touch
  const out = new Uint8ClampedArray(w * h * 4)
  compositeTouchup(rec.touch, out, null)
  return out
}

function canvasToPng(pixels, w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.putImageData(new ImageData(pixels, w, h), 0, 0)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** 用当前自动结果叠上手动覆盖层，写出预览和下载用的 PNG。 */
async function publishComposite(rec) {
  const touch = rec.touch
  if (!touch?.auto) return
  const token = (publishGen.get(rec) || 0) + 1
  publishGen.set(rec, token)
  const stale = () => publishGen.get(rec) !== token || !images.includes(rec)
  rec.edited = hasEdits(touch)
  const out = compositePixels(rec)
  const blob = await canvasToPng(out, touch.w, touch.h)
  if (stale()) return
  if (!blob) throw new Error('导出 PNG 失败')
  if (rec.resultUrl) URL.revokeObjectURL(rec.resultUrl)
  rec.resultBlob = blob
  rec.resultUrl = URL.createObjectURL(blob)
  rec.status = 'done'
  rec.error = ''
}

async function onRetouch(rec) {
  if (!rec) return
  try {
    await publishComposite(rec)
  } catch (e) {
    if (!images.includes(rec)) return
    rec.status = 'error'
    rec.error = errorText(e)
  }
}

function resetColor(rec) {
  if (!rec) return
  rec.pickedColor = null
  rec.status = 'processing'
  rec.error = ''
  runProcess(rec)
}

/* ---------------- 下载 ---------------- */

function outName(name) {
  return name.replace(/\.[^.]+$/, '') + '_抠图.png'
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}

function downloadOne(rec) {
  if (rec.resultBlob) saveBlob(rec.resultBlob, outName(rec.name))
}

async function downloadZip() {
  const ready = images.filter((i) => i.resultBlob)
  if (!ready.length || zipBusy.value) return
  zipBusy.value = true
  try {
    const zip = new JSZip()
    const used = new Set()
    ready.forEach((rec) => {
      let name = outName(rec.name)
      let i = 2
      while (used.has(name)) name = outName(rec.name).replace(/\.png$/, ` (${i++}).png`)
      used.add(name)
      zip.file(name, rec.resultBlob)
    })
    const blob = await zip.generateAsync({ type: 'blob' })
    saveBlob(blob, `抠图结果_${ready.length}张.zip`)
  } finally {
    zipBusy.value = false
  }
}

/* ---------------- 移除 ---------------- */

function removeImage(rec) {
  service.release(rec.id)
  URL.revokeObjectURL(rec.originalUrl)
  if (rec.resultUrl) URL.revokeObjectURL(rec.resultUrl)
  const idx = images.indexOf(rec)
  if (idx > -1) images.splice(idx, 1)
  if (modalId.value === rec.id) modalId.value = null
}

/* ---------------- 全局拖放 ---------------- */

function hasFiles(e) {
  return !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'))
}
function onDragEnter(e) {
  if (!hasFiles(e)) return
  isDraggingOver.value = true
}
function onDragOver(e) {
  if (hasFiles(e)) e.preventDefault()
}
function onDragLeave(e) {
  const next = e.relatedTarget
  if (next instanceof Node && document.documentElement.contains(next)) return
  isDraggingOver.value = false
}
function onDrop(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  isDraggingOver.value = false
  // 落在上传区时由 Dropzone 自己接收，避免加两遍
  if (e.target instanceof Element && e.target.closest('.dropzone')) return
  addFiles(e.dataTransfer.files)
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  service.dispose()
})
</script>

<template>
  <div class="app">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <span class="logo">
          <svg viewBox="0 0 64 64" width="22" height="22">
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#6366f1" />
                <stop offset="1" stop-color="#8b5cf6" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="13" fill="none" stroke="url(#lg)" stroke-width="5" />
            <line
              x1="41"
              y1="41"
              x2="52"
              y2="52"
              stroke="url(#lg)"
              stroke-width="5"
              stroke-linecap="round"
            />
            <line
              x1="23"
              y1="41"
              x2="12"
              y2="52"
              stroke="url(#lg)"
              stroke-width="5"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <div class="brand-text">
          <h1>Backless 智能抠图</h1>
          <p>批量去除纯色背景 · 全程本地处理</p>
        </div>
      </div>

      <div v-if="images.length" class="controls">
        <label class="slider">
          <span class="s-name">容差</span>
          <input
            v-model.number="settings.tolerance"
            type="range"
            min="0"
            max="100"
            step="1"
            :style="{ '--fill': settings.tolerance + '%' }"
            @input="onSettingsChange"
          />
          <span class="s-val">{{ settings.tolerance }}</span>
        </label>
        <label class="slider">
          <span class="s-name">羽化</span>
          <input
            v-model.number="settings.feather"
            type="range"
            min="0"
            max="10"
            step="1"
            :style="{ '--fill': (settings.feather / 10) * 100 + '%' }"
            @input="onSettingsChange"
          />
          <span class="s-val">{{ settings.feather }}</span>
        </label>
        <button class="btn primary" :disabled="!readyCount || zipBusy" @click="downloadZip">
          <svg
            v-if="!zipBusy"
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
          <i v-else class="mini-spin"></i>
          {{ zipBusy ? '打包中…' : `下载全部 (${readyCount})` }}
        </button>
      </div>
    </header>

    <!-- 主体 -->
    <main class="main">
      <Dropzone v-if="!images.length" @select="addFiles" />
      <template v-else>
        <div class="grid">
          <ImageCard
            v-for="rec in images"
            :key="rec.id"
            :image="rec"
            @open="modalId = rec.id"
            @remove="removeImage(rec)"
            @download="downloadOne(rec)"
          />
        </div>
        <div class="more-row">
          <button class="btn ghost" @click="fileInput?.click()">+ 继续添加图片</button>
        </div>
      </template>
    </main>

    <footer class="foot">
      <svg
        viewBox="0 0 24 24"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
      图片仅在浏览器本地处理，不会上传到任何服务器
    </footer>

    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFileChange" />

    <!-- 全局拖放提示层 -->
    <transition name="fade">
      <div v-if="isDraggingOver" class="drag-overlay">
        <div class="drag-inner">
          <svg
            viewBox="0 0 24 24"
            width="42"
            height="42"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 16V4m0 0-4 4m4-4 4 4" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
          <p>松开鼠标，开始批量抠图</p>
        </div>
      </div>
    </transition>

    <!-- 对比弹窗 -->
    <CompareModal
      v-if="modalImage"
      :image="modalImage"
      :tolerance="modalImage.override?.tolerance ?? settings.tolerance"
      :global-settings="settings"
      @close="modalId = null"
      @pick="(x, y) => pickColor(modalImage, x, y)"
      @reset-color="resetColor(modalImage)"
      @override="(v) => setOverride(modalImage, v)"
      @download="downloadOne(modalImage)"
      @retouch="onRetouch(modalImage)"
    />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 28px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #e9ebf3;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logo {
  display: flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: linear-gradient(135deg, #eef0ff, #f5efff);
  border: 1px solid #e3e6fb;
}
.brand-text h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.2px;
}
.brand-text p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.controls {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.slider {
  display: flex;
  align-items: center;
  gap: 9px;
}
.s-name {
  font-size: 13px;
  font-weight: 600;
  color: #4b5265;
}
.s-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
  background: #eef0ff;
  border-radius: 7px;
  padding: 2px 8px;
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.main {
  flex: 1;
  width: min(1200px, 100% - 48px);
  margin: 26px auto 40px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}
.more-row {
  margin-top: 22px;
  text-align: center;
}
.foot {
  padding: 16px;
  text-align: center;
  font-size: 12.5px;
  color: #9aa0b5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-top: 1px solid #eef0f6;
}
.drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(99, 102, 241, 0.08);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.drag-inner {
  padding: 44px 64px;
  border: 2.5px dashed var(--accent);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--accent);
  text-align: center;
  box-shadow: var(--shadow-lg);
}
.drag-inner p {
  margin: 10px 0 0;
  font-size: 15.5px;
  font-weight: 650;
}
.mini-spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
</style>
