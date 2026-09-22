<script setup>
import { ref } from 'vue'

const props = defineProps({
  override: { type: Object, default: null },
  globalSettings: { type: Object, required: true },
})
const emit = defineEmits(['override'])

/* 单图自定义参数：开启后本图容差/羽化独立，不再跟随全局设置。
   本地状态在挂载时取当前生效值；此后由用户操作驱动，不回读 props
   （父级写入 override 有防抖延迟，本地状态总是领先或等于它）。 */
const custom = ref(!!props.override)
const tolVal = ref(props.override?.tolerance ?? props.globalSettings.tolerance)
const fthVal = ref(props.override?.feather ?? props.globalSettings.feather)

function onToggleCustom() {
  emit('override', custom.value ? { tolerance: tolVal.value, feather: fthVal.value } : null)
}

function onParamInput() {
  if (!custom.value) return
  emit('override', { tolerance: tolVal.value, feather: fthVal.value })
}
</script>

<template>
  <div class="params" :class="{ on: custom }">
    <label class="p-toggle">
      <input v-model="custom" type="checkbox" @change="onToggleCustom" />
      <span>自定义参数</span>
    </label>
    <label class="p-slider">
      <span class="p-name">容差</span>
      <input
        v-model.number="tolVal"
        type="range"
        min="0"
        max="100"
        step="1"
        :disabled="!custom"
        :style="{ '--fill': tolVal + '%' }"
        @input="onParamInput"
      />
      <span class="p-val">{{ tolVal }}</span>
    </label>
    <label class="p-slider">
      <span class="p-name">羽化</span>
      <input
        v-model.number="fthVal"
        type="range"
        min="0"
        max="10"
        step="1"
        :disabled="!custom"
        :style="{ '--fill': (fthVal / 10) * 100 + '%' }"
        @input="onParamInput"
      />
      <span class="p-val">{{ fthVal }}</span>
    </label>
    <p class="p-hint">
      {{
        custom
          ? '本图使用独立参数，不受全局设置影响'
          : `跟随全局：容差 ${globalSettings.tolerance} · 羽化 ${globalSettings.feather}`
      }}
    </p>
  </div>
</template>

<style scoped>
.params {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 0 18px 12px;
  padding: 10px 14px;
  background: #f7f8fd;
  border: 1px solid #e6e9f2;
  border-radius: 10px;
}
.params.on {
  background: #eef0ff;
  border-color: #c6cdfd;
}
.p-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #4b5265;
  cursor: pointer;
  user-select: none;
}
.params.on .p-toggle {
  color: var(--accent);
}
.p-toggle input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.p-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #4b5265;
}
.p-slider input {
  width: 110px;
}
.p-slider input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.p-val {
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
.p-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
