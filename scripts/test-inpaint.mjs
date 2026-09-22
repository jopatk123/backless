/**
 * 矩形填充单元测试（Node 直接跑，无 DOM 依赖）
 * 用法: node scripts/test-inpaint.mjs
 */
import assert from 'node:assert/strict'
import { inpaintRect, selectionRect } from '../src/lib/inpaint.js'
import {
  OP_ERASE,
  createTouchup,
  compositeTouchup,
  commitStroke,
  undoTouchup,
  replayTouchup,
} from '../src/lib/touchup.js'

function solid(w, h, rgba) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = rgba[0]
    px[i * 4 + 1] = rgba[1]
    px[i * 4 + 2] = rgba[2]
    px[i * 4 + 3] = rgba[3]
  }
  return px
}

const W = 21
const H = 21
const src = solid(W, H, [10, 180, 70, 255])
for (let y = 8; y < 13; y++) {
  for (let x = 8; x < 13; x++) {
    const p = (y * W + x) * 4
    src[p] = 220
    src[p + 1] = 30
    src[p + 2] = 40
  }
}
const before = src[(10 * W + 10) * 4]

const filled = inpaintRect(src, W, H, { x: 8, y: 8, w: 5, h: 5 })
assert.ok(filled, '应返回填充结果')
assert.equal(src[(10 * W + 10) * 4], before, '填充不应改写入参')
const center = (2 * 5 + 2) * 4
assert.ok(filled[center + 1] > filled[center], '红块中心应被周围的绿色盖过')
assert.ok(filled[center + 1] > 120, '中心应接近背景绿')
assert.equal(src[3], 255, '选区外的原图像素保持不变')

assert.equal(selectionRect(1.2, 1.2, 1.4, 8, 20, 20).error, 'small')
assert.equal(selectionRect(0, 0, 20, 20, 20, 20).error, 'full')
const ok = selectionRect(10.2, 4.8, 2.1, 9.2, 30, 30)
assert.deepEqual({ x: ok.x, y: ok.y, w: ok.w, h: ok.h }, { x: 2, y: 4, w: 9, h: 6 })

// 填充记在颜色层上：后画的擦除盖住它，撤销后填充回来；换一份自动结果也还在
const state = createTouchup(solid(W, H, [10, 180, 70, 255]), W, H)
state.auto = solid(W, H, [10, 180, 70, 255])
commitStroke(state, { kind: 'fill', x: 8, y: 8, w: 5, h: 5, pixels: filled })
replayTouchup(state)
const view = new Uint8ClampedArray(W * H * 4)
compositeTouchup(state, view, null)
assert.ok(view[(10 * W + 10) * 4 + 1] > 120, '合成结果应看到填充')
assert.equal(view[(0 * W + 0) * 4 + 1], 180, '选区外仍是自动结果')

commitStroke(state, {
  kind: 'brush',
  op: OP_ERASE,
  points: [{ x: 10.5, y: 10.5, radius: 0.5, hardness: 1 }],
})
replayTouchup(state)
compositeTouchup(state, view, null)
assert.equal(view[(10 * W + 10) * 4 + 3], 0, '后画的擦除应盖住填充')

undoTouchup(state)
compositeTouchup(state, view, null)
assert.ok(view[(10 * W + 10) * 4 + 3] > 200, '撤销擦除后填充应回来')

const nextAuto = solid(W, H, [1, 2, 3, 255])
state.auto = nextAuto
compositeTouchup(state, view, null)
assert.ok(view[(10 * W + 10) * 4 + 1] > 120, '重算自动结果后填充仍在')
assert.equal(view[0], 1, '没填过的像素跟新的自动结果')

console.log('✔ 矩形填充断言通过')
