<script setup>
import { computed } from 'vue'

const props = defineProps({
  image: { type: Object, required: true },
})
defineEmits(['open', 'remove', 'download'])

const refColor = computed(() => props.image.pickedColor || props.image.autoColor)
const refStyle = computed(() => {
  const [r, g, b] = refColor.value || [128, 128, 128]
  return { background: `rgb(${r},${g},${b})` }
})
const refTitle = computed(() => {
  if (!refColor.value) return ''
  const hex = '#' + refColor.value.map((v) => v.toString(16).padStart(2, '0')).join('')
  return `当前背景参考色 ${hex}（${props.image.pickedColor ? '手动吸取' : '自动识别'}）`
})
const sizeText = computed(() => {
  const kb = props.image.size / 1024
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB'
  if (kb >= 10) return Math.round(kb) + ' KB'
  if (kb >= 0.1) return kb.toFixed(1) + ' KB'
  return '1 KB'
})
</script>

<template>
  <div class="card">
    <div class="thumb" @click="$emit('open')">
      <img class="shot" :src="image.resultUrl || image.originalUrl" alt="" draggable="false" />
      <span
        class="ref-dot"
        :class="{ picked: !!image.pickedColor }"
        :style="refStyle"
        :title="refTitle"
      ></span>
      <transition name="fade">
        <span v-if="image.status !== 'done'" class="badge" :class="image.status">
          {{
            image.status === 'loading'
              ? '读取中'
              : image.status === 'processing'
                ? '处理中'
                : image.error || '处理失败'
          }}
        </span>
      </transition>
      <span class="hover-tip">点击对比</span>
      <button class="remove" title="移除" @click.stop="$emit('remove')">
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
    <div class="meta">
      <p class="name" :title="image.name">{{ image.name }}</p>
      <p class="sub">{{ image.width }}×{{ image.height }} · {{ sizeText }}</p>
    </div>
    <div class="actions">
      <button class="btn ghost sm" :disabled="!image.resultBlob" @click="$emit('download')">
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16" />
        </svg>
        下载
      </button>
      <button class="btn primary sm" @click="$emit('open')">对比</button>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #eceef5;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition:
    transform 0.22s ease,
    box-shadow 0.22s ease;
  animation: rise 0.4s ease both;
}
.card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}
.thumb {
  position: relative;
  height: 190px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: repeating-conic-gradient(#eef0f5 0% 25%, #ffffff 0% 50%) 0 0 / 18px 18px;
  overflow: hidden;
}
.shot {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transition: transform 0.3s ease;
}
.thumb:hover .shot {
  transform: scale(1.05);
}
.ref-dot {
  position: absolute;
  left: 10px;
  bottom: 10px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  cursor: help;
}
.ref-dot.picked {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.badge {
  position: absolute;
  top: 10px;
  left: 10px;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.72);
  color: #fff;
  backdrop-filter: blur(4px);
}
.badge.processing {
  background: rgba(99, 102, 241, 0.88);
}
.badge.error {
  background: rgba(239, 68, 68, 0.9);
}
.badge.processing::before {
  content: '';
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 50%;
  border: 1.5px solid #fff;
  border-top-color: transparent;
  animation: spin 0.7s linear infinite;
  vertical-align: -1px;
}
.hover-tip {
  position: absolute;
  inset: auto 0 0 0;
  padding: 6px;
  text-align: center;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(transparent, rgba(17, 24, 39, 0.65));
  opacity: 0;
  transform: translateY(4px);
  transition: all 0.22s ease;
  pointer-events: none;
}
.thumb:hover .hover-tip {
  opacity: 1;
  transform: none;
}
.remove {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.5);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;
}
.thumb:hover .remove,
.remove:focus-visible {
  opacity: 1;
}
.remove:hover {
  background: #ef4444;
}
.meta {
  padding: 10px 12px 4px;
}
.name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px 12px;
}
.actions .btn {
  flex: 1;
}
</style>
