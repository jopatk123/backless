<script setup>
import { ref } from 'vue'

const emit = defineEmits(['select'])
const inputEl = ref(null)
const dragActive = ref(false)

function onDrop(e) {
  dragActive.value = false
  emit('select', e.dataTransfer.files)
}

function onFileChange(e) {
  emit('select', e.target.files)
  e.target.value = ''
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ active: dragActive }"
    @click="inputEl.click()"
    @dragenter.prevent="dragActive = true"
    @dragover.prevent="dragActive = true"
    @dragleave.prevent="dragActive = false"
    @drop.prevent="onDrop"
  >
    <input ref="inputEl" type="file" accept="image/*" multiple hidden @change="onFileChange" />
    <div class="dz-icon">
      <svg
        viewBox="0 0 24 24"
        width="44"
        height="44"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 16V4m0 0 -4 4m4-4 4 4" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    </div>
    <h2>拖拽图片到此处，或点击选择</h2>
    <p>支持批量上传 · 自动识别并去除纯色背景</p>
    <ul class="dz-features">
      <li>容差可调</li>
      <li>边缘羽化</li>
      <li>手动吸色</li>
      <li>手动修边</li>
      <li>对比预览</li>
      <li>ZIP 打包下载</li>
    </ul>
  </div>
</template>

<style scoped>
.dropzone {
  border: 2px dashed #d4d8e8;
  border-radius: 20px;
  padding: 72px 32px;
  text-align: center;
  cursor: pointer;
  background: #fff;
  transition: all 0.25s ease;
  animation: rise 0.45s ease both;
}
.dropzone:hover,
.dropzone.active {
  border-color: var(--accent);
  background: linear-gradient(180deg, #f7f5ff 0%, #fff 70%);
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
.dz-icon {
  display: inline-flex;
  width: 92px;
  height: 92px;
  align-items: center;
  justify-content: center;
  border-radius: 28px;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 12px 28px -8px rgba(99, 102, 241, 0.55);
  margin-bottom: 22px;
}
h2 {
  font-size: 21px;
  font-weight: 650;
  color: var(--text);
  margin: 0 0 8px;
}
.dropzone > p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.dz-features {
  list-style: none;
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  padding: 0;
  margin: 26px 0 0;
}
.dz-features li {
  font-size: 12.5px;
  color: #6b7280;
  background: #f3f4f8;
  border: 1px solid #e8eaf2;
  padding: 5px 12px;
  border-radius: 999px;
}
</style>
