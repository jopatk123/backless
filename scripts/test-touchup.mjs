/**
 * 修边覆盖层单元测试（Node 直接跑，无 DOM 依赖）
 * 用法: node scripts/test-touchup.mjs
 */
import assert from 'node:assert/strict'
import {
  OP_AUTO,
  OP_KEEP,
  OP_ERASE,
  createTouchup,
  paintDab,
  paintSegment,
  applyMask,
  collectFlood,
  stampIndices,
  commitStroke,
  undoTouchup,
  redoTouchup,
  hasEdits,
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

function at(px, w, x, y) {
  const p = (y * w + x) * 4
  return [px[p], px[p + 1], px[p + 2], px[p + 3]]
}

const W = 24
const H = 24
const original = solid(W, H, [220, 40, 50, 255])
const state = createTouchup(original, W, H)
state.auto = solid(W, H, [220, 40, 50, 255])

// 1. 硬笔刷只擦掉笔心那一个像素，且不改自动结果本身
paintDab(state, 5.5, 5.5, 0.5, 1, OP_ERASE)
assert.equal(state.op[5 * W + 5], OP_ERASE)
assert.equal(state.weight[5 * W + 5], 255)
assert.equal(state.op[5 * W + 6], OP_AUTO, '半径 0.5 不应碰到相邻像素')
assert.equal(state.auto[(5 * W + 5) * 4 + 3], 255, '笔刷不应改写自动结果')

const out = new Uint8ClampedArray(original.length)
applyMask(state.auto, state.original, state.op, state.weight, out, W, null)
assert.deepEqual(at(out, W, 5, 5), [0, 0, 0, 0], '强制擦除后应全透明')
assert.equal(at(out, W, 6, 5)[3], 255, '笔刷外应保持自动结果')
assert.equal(state.auto[(5 * W + 5) * 4 + 3], 255, 'applyMask 不应改写入参')

// 2. 半强度擦除：不透明像素 alpha 约减半
state.op.fill(0)
state.weight.fill(0)
state.weight[0] = 128
state.op[0] = OP_ERASE
out[1 * W * 4 + 3] = 7
applyMask(state.auto, state.original, state.op, state.weight, out, W, { x: 0, y: 0, w: 1, h: 1 })
assert.equal(out[3], 127, '50% 擦除应留下约一半 alpha')
assert.equal(out[1 * W * 4 + 3], 7, '矩形外不应被局部合成改掉')

// 3. 还原：把已经抠掉的像素涂回原图颜色
state.op.fill(0)
state.weight.fill(0)
state.auto.fill(0)
paintDab(state, 8.5, 8.5, 0.5, 1, OP_KEEP)
applyMask(state.auto, state.original, state.op, state.weight, out, W, null)
assert.deepEqual(at(out, W, 8, 8), [220, 40, 50, 255], '还原应取回原图像素')

// 4. 后一笔不同操作覆盖前一笔，同一笔软边重叠不把中心挖薄
state.op.fill(0)
state.weight.fill(0)
state.auto = solid(W, H, [1, 2, 3, 255])
paintDab(state, 10.5, 10.5, 4, 0, OP_ERASE)
const center = 10 * W + 10
const mid = state.weight[center]
paintDab(state, 12.5, 10.5, 4, 0, OP_ERASE)
assert.ok(state.weight[center] >= mid, '同一操作的软边重叠应保留较大强度')
paintDab(state, 10.5, 10.5, 0.5, 1, OP_KEEP)
assert.equal(state.op[center], OP_KEEP, '还原应盖过之前的擦除')

// 5. 快速拖动的线段中间也被盖到
state.op.fill(0)
state.weight.fill(0)
paintSegment(state, 1.5, 4.5, 22.5, 4.5, 1, 1, OP_ERASE)
assert.equal(state.op[4 * W + 12], OP_ERASE, '线段中点应被补笔盖到')

// 6. 擦这块：只清可见且颜色接近的连通块，不穿过透明区
const fw = 30
const fh = 30
const orig = solid(fw, fh, [10, 180, 70, 255])
const view = solid(fw, fh, [0, 0, 0, 0])
// 两块同色绿岛，中间被透明隔开；绿岛旁边一个可见的红色像素
for (let y = 8; y < 14; y++) {
  for (let x = 8; x < 14; x++) view[(y * fw + x) * 4 + 3] = 255
}
for (let y = 8; y < 14; y++) {
  for (let x = 20; x < 26; x++) view[(y * fw + x) * 4 + 3] = 255
}
const edge = (10 * fw + 14) * 4
orig[edge] = 220
orig[edge + 1] = 40
orig[edge + 2] = 50
view[edge + 3] = 255
const indices = collectFlood(orig, view, fw, fh, 10, 10, 30)
assert.equal(indices.length, 36, '应只包含第一块 6×6 绿岛')
const set = new Set(indices)
assert.equal(set.has(10 * fw + 14), false, '相邻异色像素不应被擦')
assert.equal(set.has(10 * fw + 22), false, '透明区另一侧的同色块不应被擦')
assert.equal(collectFlood(orig, view, fw, fh, 0, 0, 30).length, 0, '点在透明处应无结果')

const floodState = createTouchup(orig, fw, fh)
floodState.auto = solid(fw, fh, [10, 180, 70, 255])
stampIndices(floodState.op, floodState.weight, indices, OP_ERASE)
commitStroke(floodState, { kind: 'flood', indices })
assert.equal(hasEdits(floodState), true)
undoTouchup(floodState)
assert.equal(floodState.op[10 * fw + 10], OP_AUTO, '撤销应回到自动结果')
assert.equal(hasEdits(floodState), false)
redoTouchup(floodState)
assert.equal(floodState.op[10 * fw + 10], OP_ERASE, '重做应恢复擦除')

// 7. 新笔画丢掉重做栈；清除可撤销，撤销后回到擦这块
const tiny = createTouchup(solid(4, 4, [0, 0, 0, 255]), 4, 4)
commitStroke(tiny, {
  kind: 'brush',
  op: OP_ERASE,
  points: [{ x: 1.5, y: 1.5, radius: 0.5, hardness: 1 }],
})
undoTouchup(tiny)
assert.equal(tiny.redo.length, 1)
commitStroke(tiny, { kind: 'reset' })
assert.equal(tiny.redo.length, 0, '新笔画应清掉重做栈')

floodState.op.fill(0)
floodState.weight.fill(0)
commitStroke(floodState, { kind: 'reset' })
assert.equal(hasEdits(floodState), false)
undoTouchup(floodState)
assert.equal(hasEdits(floodState), true)
assert.equal(floodState.op[10 * fw + 10], OP_ERASE, '撤销清除后应回到擦这块')

// 8. 换一份自动结果后，旧的擦除仍然生效
const freshAuto = solid(fw, fh, [10, 180, 70, 255])
const composited = new Uint8ClampedArray(orig.length)
applyMask(freshAuto, orig, floodState.op, floodState.weight, composited, fw, null)
assert.equal(composited[(10 * fw + 10) * 4 + 3], 0, '重算后覆盖层仍应擦掉该像素')
assert.equal(composited[(10 * fw + 22) * 4 + 3], 255, '没涂过的像素跟自动结果')

console.log('✔ 修边覆盖层断言通过')
