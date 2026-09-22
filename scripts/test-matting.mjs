/**
 * 抠图算法单元测试（Node 直接跑，无 DOM 依赖）
 * 用法: node scripts/test-matting.mjs
 */
import assert from 'node:assert/strict'
import { detectEdgeColor, processMatting, samplePatchColor } from '../src/lib/matting.js'

const W = 200
const H = 150

// 构造测试图：绿色背景（带轻微渐变）+ 中间红色圆 + 圆内部一个绿色小方块（不与边缘连通）
const GREEN = [10, 190, 80]
const RED = [220, 50, 60]
const data = new Uint8ClampedArray(W * H * 4)

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    let [r, g, b] = GREEN
    g += Math.round((x / W) * 10) // 渐变干扰
    if (inCircle(x, y, 100, 75, 45)) [r, g, b] = RED
    if (x >= 90 && x < 110 && y >= 65 && y < 85) [r, g, b] = GREEN // 圆内绿色块
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
}

// 1. 背景色自动识别
const auto = detectEdgeColor(data, W, H)
assert.ok(
  Math.abs(auto[0] - 12) <= 6 && Math.abs(auto[1] - 195) <= 6 && Math.abs(auto[2] - 80) <= 6,
  `detectEdgeColor 应识别为绿色系, 实际 ${auto}`
)

// 2. 去背景（容差 20，羽化 0）
const out = processMatting(data, W, H, { tolerance: 20, feather: 0, refColor: auto })

const a = (x, y) => out[(y * W + x) * 4 + 3]
assert.equal(a(0, 0), 0, '角像素应为透明')
assert.equal(a(W - 1, H - 1), 0, '角像素应为透明')
assert.equal(a(100, 75), 255, '圆心应保留')
assert.equal(a(100, 30), 255, '圆上部应保留')
assert.equal(a(95, 75), 255, '圆内绿色方块（不与边缘连通）不应被移除')
assert.equal(a(5, 75), 0, '圆外左侧背景应透明')

// 3. 原始数据不被修改
assert.equal(data[(0 * W + 0) * 4 + 3], 255, '入参 src 不应被修改')

// 4. 羽化：边界出现中间 alpha
const out2 = processMatting(data, W, H, { tolerance: 20, feather: 3, refColor: auto })
// 圆边缘外侧一点（背景刚要变透明的过渡带）
let found = false
for (let y = 0; y < H && !found; y++)
  for (let x = 0; x < W; x++) {
    const al = out2[(y * W + x) * 4 + 3]
    if (al > 0 && al < 255) {
      found = true
      break
    }
  }
assert.ok(found, '羽化后应存在半透明过渡像素')

// 5. 手动指定参考色（红色 → 反向：移除圆外圈? 不, 移除与边缘连通的红色区域=无）
const out3 = processMatting(data, W, H, { tolerance: 20, feather: 0, refColor: RED })
assert.equal(out3[(0 * W + 0) * 4 + 3], 255, '指定红色为背景时，绿色边缘不应被移除')

// 6. 容差为 0：渐变背景下只有非常接近参考色的像素被移除
const out4 = processMatting(data, W, H, { tolerance: 0, feather: 0, refColor: GREEN })
assert.equal(out4[(0 * W + 0) * 4 + 3], 0, '容差 0 时与参考色完全一致的像素仍被移除')

// 7. 性能抽测（100 万像素级别）
const Wp = 1200
const Hp = 900
const big = new Uint8ClampedArray(Wp * Hp * 4).fill(255)
for (let i = 0; i < Wp * Hp; i++) {
  big[i * 4] = 200
  big[i * 4 + 1] = 200
  big[i * 4 + 2] = 200
}
const t0 = performance.now()
processMatting(big, Wp, Hp, { tolerance: 20, feather: 2, refColor: [200, 200, 200] })
const cost = performance.now() - t0
assert.ok(cost < 1500, `1M 像素应在 1.5s 内完成, 实际 ${cost.toFixed(0)}ms`)

// 8. 吸色：周围平均，单点噪点不能代表整块颜色
{
  const pw = 7
  const ph = 7
  const patch = new Uint8ClampedArray(pw * ph * 4)
  for (let i = 0; i < pw * ph; i++) {
    patch[i * 4] = 200
    patch[i * 4 + 1] = 200
    patch[i * 4 + 2] = 200
    patch[i * 4 + 3] = 255
  }
  const center = (3 * pw + 3) * 4
  patch[center] = 0
  patch[center + 1] = 0
  patch[center + 2] = 255
  const sampled = samplePatchColor(patch, pw, ph, 3, 3)
  assert.ok(
    sampled[0] > 180 && sampled[1] > 180 && sampled[2] < 220,
    `5×5 平均应仍接近灰底, 实际 ${sampled}`
  )
  assert.deepEqual(samplePatchColor(patch, pw, ph, 3, 3, 0), [0, 0, 255], '半径 0 应只取中心像素')
}

// 9. 吸色：跳过透明像素，并钳制越界坐标
{
  const pw = 3
  const ph = 3
  const patch = new Uint8ClampedArray(pw * ph * 4)
  patch[0] = 10
  patch[1] = 20
  patch[2] = 30
  patch[3] = 255
  const sampled = samplePatchColor(patch, pw, ph, -4, 99)
  assert.deepEqual(sampled, [10, 20, 30], '越界应钳制到角点，并忽略周围透明像素')
  assert.equal(samplePatchColor(null, 1, 1, 0, 0), null)
}

console.log(`✔ 全部断言通过（${Wp}x${Hp} 处理耗时 ${cost.toFixed(0)}ms）`)
