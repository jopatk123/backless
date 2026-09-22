/**
 * 纯色背景抠除核心算法（无 DOM 依赖，可在 Worker / Node 中运行）
 *
 * 思路：
 * 1. 从图片四周边框像素中自动投票得出"背景色"（也可手动吸取指定）
 * 2. 以参考色为中心，按容差做"边缘泛洪"——只移除与边缘连通的相似色区域，
 *    不会误删图片内部与背景同色的主体部分
 * 3. 对 alpha 做盒式模糊实现边缘羽化，并去掉背景色镶边
 */

/**
 * 采样四周边框像素，量化后多数投票得出背景色
 * @returns {[number, number, number]} RGB
 */
export function detectEdgeColor(data, w, h) {
  const bins = new Map()
  const add = (i) => {
    const p = i * 4
    if (data[p + 3] === 0) return
    const r = data[p],
      g = data[p + 1],
      b = data[p + 2]
    // 量化到 16 级/通道，抗噪
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    let bin = bins.get(key)
    if (!bin) {
      bin = { n: 0, r: 0, g: 0, b: 0 }
      bins.set(key, bin)
    }
    bin.n++
    bin.r += r
    bin.g += g
    bin.b += b
  }
  for (let x = 0; x < w; x++) add(x)
  if (h > 1) {
    for (let x = 0; x < w; x++) add((h - 1) * w + x)
  }
  for (let y = 1; y < h - 1; y++) {
    add(y * w)
    if (w > 1) add(y * w + w - 1)
  }
  let best = null
  for (const bin of bins.values()) {
    if (!best || bin.n > best.n) best = bin
  }
  if (!best) return [0, 0, 0]
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
}

/** 可分离盒式模糊（水平 + 垂直，边缘钳制，滑窗 O(n)），结果写回 buf */
function boxBlurBuffer(buf, w, h, r, tmp) {
  const win = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += buf[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win
      sum += buf[row + Math.min(w - 1, x + r + 1)] - buf[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      buf[y * w + x] = sum / win
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
}

/**
 * 羽化 alpha，并把半透明边缘的 RGB 换成前景色。
 * 只模糊 alpha 会留下背景色镶边；这里对预乘颜色一起模糊再还原。
 */
function featherEdges(px, w, h, radius) {
  const r = Math.max(1, Math.round(radius))
  const n = w * h
  const alpha = new Float32Array(n)
  const cr = new Float32Array(n)
  const cg = new Float32Array(n)
  const cb = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const a = px[p + 3] / 255
    alpha[i] = a
    cr[i] = px[p] * a
    cg[i] = px[p + 1] * a
    cb[i] = px[p + 2] * a
  }
  const tmp = new Float32Array(n)
  boxBlurBuffer(alpha, w, h, r, tmp)
  boxBlurBuffer(cr, w, h, r, tmp)
  boxBlurBuffer(cg, w, h, r, tmp)
  boxBlurBuffer(cb, w, h, r, tmp)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const a = alpha[i]
    if (a <= 1 / 255) {
      px[p + 3] = 0
      continue
    }
    const inv = 1 / a
    px[p] = Math.min(255, Math.max(0, Math.round(cr[i] * inv)))
    px[p + 1] = Math.min(255, Math.max(0, Math.round(cg[i] * inv)))
    px[p + 2] = Math.min(255, Math.max(0, Math.round(cb[i] * inv)))
    px[p + 3] = Math.min(255, Math.max(0, Math.round(a * 255)))
  }
}

/** 手动吸色的取样半径（像素）。半径 2 即 5×5，用来压住单点噪点和压缩色块。 */
export const SAMPLE_RADIUS = 2

/**
 * 取 (x, y) 周围不透明像素的平均色，坐标会钳制在图内。
 * 周围全透明时退回中心像素的 RGB。
 * @returns {[number, number, number] | null}
 */
export function samplePatchColor(data, w, h, x, y, radius = SAMPLE_RADIUS) {
  if (!data || w < 1 || h < 1) return null
  const cx = clampInt(x, 0, w - 1)
  const cy = clampInt(y, 0, h - 1)
  const r = Math.max(0, radius | 0)
  const x0 = Math.max(0, cx - r)
  const y0 = Math.max(0, cy - r)
  const x1 = Math.min(w - 1, cx + r)
  const y1 = Math.min(h - 1, cy + r)
  let n = 0
  let sr = 0
  let sg = 0
  let sb = 0
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w
    for (let xx = x0; xx <= x1; xx++) {
      const p = (row + xx) * 4
      if (data[p + 3] === 0) continue
      sr += data[p]
      sg += data[p + 1]
      sb += data[p + 2]
      n++
    }
  }
  if (!n) {
    const p = (cy * w + cx) * 4
    return [data[p], data[p + 1], data[p + 2]]
  }
  return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)]
}

function clampInt(value, min, max) {
  const n = value | 0
  if (n < min) return min
  if (n > max) return max
  return n
}

/** 容差 0–100 映射为 RGB 欧氏距离平方上限（容差 × 1.4）。修边泛洪与抠图共用。 */
export function colorMatchLimit(tolerance) {
  const maxD = tolerance * 1.4
  return maxD * maxD
}

/**
 * 边缘泛洪 + 容差去背景（不修改入参 src）
 *
 * @param {Uint8ClampedArray} src 原始 RGBA 像素
 * @param {number} w 宽
 * @param {number} h 高
 * @param {object} opts
 *   - tolerance: 0-100，颜色相似度阈值（映射到欧氏距离 0-140）
 *   - feather:   羽化半径（像素，0 表示不羽化）
 *   - refColor:  [r,g,b] 参考背景色
 * @returns {Uint8ClampedArray} 处理后的 RGBA 像素（新数组）
 */
export function processMatting(src, w, h, { tolerance = 30, feather = 0, refColor = [0, 255, 0] }) {
  const n = w * h
  const out = new Uint8ClampedArray(src) // 拷贝，保留原始数据
  const maxD2 = colorMatchLimit(tolerance)
  const [cr, cg, cb] = refColor

  const removed = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  // 命中参考色（欧氏距离平方 <= 阈值平方）则入队
  const pushIf = (i) => {
    if (removed[i]) return
    const p = i * 4
    const dr = src[p] - cr
    const dg = src[p + 1] - cg
    const db = src[p + 2] - cb
    if (dr * dr + dg * dg + db * db <= maxD2) {
      removed[i] = 1
      queue[tail++] = i
    }
  }

  // 从四条边播种
  for (let x = 0; x < w; x++) {
    pushIf(x)
    pushIf((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    pushIf(y * w)
    pushIf(y * w + w - 1)
  }

  // BFS 泛洪（4 邻域）
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    if (x > 0) pushIf(i - 1)
    if (x < w - 1) pushIf(i + 1)
    if (y > 0) pushIf(i - w)
    if (y < h - 1) pushIf(i + w)
  }

  // 应用透明
  for (let i = 0; i < n; i++) {
    if (removed[i]) out[i * 4 + 3] = 0
  }

  if (feather > 0) featherEdges(out, w, h, feather)

  return out
}
