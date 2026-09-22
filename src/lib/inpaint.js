/**
 * 矩形区域的边缘扩散填充（无 DOM 依赖）
 *
 * 从选区边界一圈圈往里，用外侧已确定的像素做加权平均。
 * 适合纯色、渐变上的小块水印；细节纹理会被抹平。
 */

export const FILL_RADIUS = 5
export const MAX_FILL_PIXELS = 800000

function clamp8(v) {
  if (v <= 0) return 0
  if (v >= 255) return 255
  return Math.round(v)
}

/** 把拖拽的两个角收成图像内的整数矩形。太小或太大时返回 null。 */
export function selectionRect(x0, y0, x1, y1, width, height) {
  let left = Math.floor(Math.min(x0, x1))
  let top = Math.floor(Math.min(y0, y1))
  let right = Math.ceil(Math.max(x0, x1))
  let bottom = Math.ceil(Math.max(y0, y1))
  left = Math.max(0, Math.min(width, left))
  top = Math.max(0, Math.min(height, top))
  right = Math.max(0, Math.min(width, right))
  bottom = Math.max(0, Math.min(height, bottom))
  const w = right - left
  const h = bottom - top
  if (w < 2 || h < 2) return { error: 'small' }
  if (w * h > MAX_FILL_PIXELS) return { error: 'large' }
  if (w >= width && h >= height) return { error: 'full' }
  return { x: left, y: top, w, h }
}

function outward(x, y, hx, hy, hw, hh) {
  const dl = x - hx + 1
  const dr = hx + hw - x
  const dt = y - hy + 1
  const db = hy + hh - y
  const d = Math.min(dl, dr, dt, db)
  let nx = 0
  let ny = 0
  if (dl === d) nx -= 1
  if (dr === d) nx += 1
  if (dt === d) ny -= 1
  if (db === d) ny += 1
  const len = Math.hypot(nx, ny) || 1
  return { d, nx: nx / len, ny: ny / len }
}

/**
 * 填充 rect 内的像素，返回这块的 RGBA（不修改 src）。
 * 选区外没有可参考像素时返回 null。
 * @param {Uint8ClampedArray} src
 */
export function inpaintRect(src, width, height, rect, radius = FILL_RADIUS) {
  const x0 = Math.max(0, rect.x | 0)
  const y0 = Math.max(0, rect.y | 0)
  const x1 = Math.min(width, x0 + (rect.w | 0))
  const y1 = Math.min(height, y0 + (rect.h | 0))
  const rw = x1 - x0
  const rh = y1 - y0
  if (rw < 1 || rh < 1) return null

  const rad = Math.max(1, radius | 0)
  const bx0 = Math.max(0, x0 - rad)
  const by0 = Math.max(0, y0 - rad)
  const bx1 = Math.min(width, x1 + rad)
  const by1 = Math.min(height, y1 + rad)
  const bw = bx1 - bx0
  const bh = by1 - by0
  if (bw === rw && bh === rh) return null

  const buf = new Uint8ClampedArray(bw * bh * 4)
  for (let y = 0; y < bh; y++) {
    const from = ((by0 + y) * width + bx0) * 4
    buf.set(src.subarray(from, from + bw * 4), y * bw * 4)
  }

  const hx = x0 - bx0
  const hy = y0 - by0
  const n = bw * bh
  const known = new Uint8Array(n)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (x < hx || y < hy || x >= hx + rw || y >= hy + rh) known[y * bw + x] = 1
    }
  }

  const holeN = rw * rh
  const order = new Int32Array(holeN)
  const dist = new Uint16Array(holeN)
  const nx = new Float32Array(holeN)
  const ny = new Float32Array(holeN)
  let count = 0
  for (let y = hy; y < hy + rh; y++) {
    for (let x = hx; x < hx + rw; x++) {
      const info = outward(x, y, hx, hy, rw, rh)
      order[count] = y * bw + x
      dist[count] = info.d
      nx[count] = info.nx
      ny[count] = info.ny
      count++
    }
  }
  const rank = Int32Array.from({ length: holeN }, (_, i) => i)
  rank.sort((a, b) => dist[a] - dist[b])

  const pending = []
  let shell = dist[rank[0]]
  const flush = () => {
    for (let k = 0; k < pending.length; k++) {
      const item = pending[k]
      const p = item.i * 4
      buf[p] = item.r
      buf[p + 1] = item.g
      buf[p + 2] = item.b
      buf[p + 3] = item.a
      known[item.i] = 1
    }
    pending.length = 0
  }

  for (let k = 0; k < holeN; k++) {
    const id = rank[k]
    if (dist[id] !== shell) {
      flush()
      shell = dist[id]
    }
    const i = order[id]
    const x = i % bw
    const y = (i - x) / bw
    const color = sample(buf, known, bw, bh, x, y, nx[id], ny[id], rad, shell)
    pending.push(
      color
        ? { i, ...color }
        : { i, r: buf[i * 4], g: buf[i * 4 + 1], b: buf[i * 4 + 2], a: buf[i * 4 + 3] }
    )
  }
  flush()

  const out = new Uint8ClampedArray(rw * rh * 4)
  for (let y = 0; y < rh; y++) {
    const from = ((hy + y) * bw + hx) * 4
    out.set(buf.subarray(from, from + rw * 4), y * rw * 4)
  }
  return out
}

function sample(buf, known, bw, bh, x, y, nx, ny, rad, shell) {
  let sr = 0
  let sg = 0
  let sb = 0
  let sa = 0
  let wsum = 0
  let fr = 0
  let fg = 0
  let fb = 0
  let fa = 0
  let fsum = 0
  const r2 = rad * rad
  for (let dy = -rad; dy <= rad; dy++) {
    const qy = y + dy
    if (qy < 0 || qy >= bh) continue
    for (let dx = -rad; dx <= rad; dx++) {
      const qx = x + dx
      if (qx < 0 || qx >= bw) continue
      const dist2 = dx * dx + dy * dy
      if (dist2 === 0 || dist2 > r2) continue
      const qi = qy * bw + qx
      if (!known[qi]) continue
      const dist = Math.sqrt(dist2)
      const p = qi * 4
      const alpha = buf[p + 3] / 255
      const fall = 1 / dist2
      fr += buf[p] * alpha * fall
      fg += buf[p + 1] * alpha * fall
      fb += buf[p + 2] * alpha * fall
      fa += alpha * fall
      fsum += fall
      const align = (dx * nx + dy * ny) / dist
      if (align <= 0) continue
      const weight = align * fall * (1 / (1 + Math.abs(shell - 0)))
      sr += buf[p] * alpha * weight
      sg += buf[p + 1] * alpha * weight
      sb += buf[p + 2] * alpha * weight
      sa += alpha * weight
      wsum += weight
    }
  }
  const useFallback = wsum <= 1e-6
  const rw = useFallback ? fsum : wsum
  const rr = useFallback ? fr : sr
  const rg = useFallback ? fg : sg
  const rb = useFallback ? fb : sb
  const ra = useFallback ? fa : sa
  if (rw <= 1e-6) return null
  if (ra <= 1e-4) return { r: 0, g: 0, b: 0, a: 0 }
  const inv = 1 / ra
  return {
    r: clamp8(rr * inv),
    g: clamp8(rg * inv),
    b: clamp8(rb * inv),
    a: clamp8((ra / rw) * 255),
  }
}
