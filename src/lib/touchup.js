/**
 * 手动修边（无 DOM 依赖）
 *
 * 自动抠图的结果之上叠一层覆盖：
 *   op 0 = 交给自动抠图，1 = 强制保留，2 = 强制擦除
 *   weight 0–255 = 这一笔的覆盖强度（软边）
 *
 * 笔画进 undo 栈，撤销时从空覆盖重放，这样调容差重算后仍能叠上去。
 * 填充另记一层颜色：每个像素上，代数更大的那一笔生效。
 */
import { colorMatchLimit } from './matting.js'

export const OP_AUTO = 0
export const OP_KEEP = 1
export const OP_ERASE = 2

export function createTouchup(original, w, h) {
  return {
    w,
    h,
    original,
    auto: null,
    op: new Uint8Array(w * h),
    weight: new Uint8Array(w * h),
    // 出现填充后才分配：opGen / paintGen 决定擦除和填充谁盖住谁
    opGen: null,
    paint: null,
    paintGen: null,
    seq: 0,
    undo: [],
    redo: [],
  }
}

function ensurePaint(state) {
  const n = state.w * state.h
  if (!state.opGen) state.opGen = new Uint32Array(n)
  if (!state.paint) state.paint = new Uint8ClampedArray(n * 4)
  if (!state.paintGen) state.paintGen = new Uint32Array(n)
}

export function unionRect(a, b) {
  if (!a || a.w <= 0 || a.h <= 0) return b || null
  if (!b || b.w <= 0 || b.h <= 0) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const x2 = Math.max(a.x + a.w, b.x + b.w)
  const y2 = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: x2 - x, h: y2 - y }
}

/** 在 (cx, cy) 印一笔。同一操作取较大强度，换操作则覆盖。返回受影响的像素矩形。 */
export function paintDab(state, cx, cy, radius, hardness, target, gen = 0) {
  const { w, h, op, weight } = state
  const r = Math.max(0.5, radius)
  const hard = hardness < 0 ? 0 : hardness > 1 ? 1 : hardness
  const inner = r * hard
  const x0 = Math.max(0, Math.floor(cx - r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  if (x1 < x0 || y1 < y0) return null
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      let strength = 0
      if (dist <= inner) strength = 255
      else if (dist <= r) {
        const span = r - inner
        strength = span <= 0 ? 255 : Math.round(255 * (1 - (dist - inner) / span))
      }
      if (strength <= 0) continue
      const i = y * w + x
      if (op[i] === target) {
        if (strength > weight[i]) weight[i] = strength
      } else {
        op[i] = target
        weight[i] = strength
      }
      if (gen > 0 && state.opGen) state.opGen[i] = gen
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** 沿两点补笔，避免快速拖动留下空隙。中间笔印使用终点的半径和硬度。 */
export function paintSegment(state, x0, y0, x1, y1, radius, hardness, target, gen = 0) {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(1, radius * 0.35)
  const n = Math.max(1, Math.ceil(dist / step))
  let rect = null
  for (let i = 0; i <= n; i++) {
    const t = i / n
    rect = unionRect(
      rect,
      paintDab(state, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, hardness, target, gen)
    )
  }
  return rect
}

export function applyBrushStroke(state, stroke, gen = 0) {
  const pts = stroke.points
  if (!pts || !pts.length) return null
  let rect = paintDab(state, pts[0].x, pts[0].y, pts[0].radius, pts[0].hardness, stroke.op, gen)
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    rect = unionRect(
      rect,
      paintSegment(state, prev.x, prev.y, p.x, p.y, p.radius, p.hardness, stroke.op, gen)
    )
  }
  return rect
}

/**
 * 从点击处按容差收集一块连通的可见像素（4 邻域）。
 * 颜色和原图比，是否可见看当前合成结果的 alpha，避免穿过已经抠掉的背景连到另一块。
 * @returns {Int32Array}
 */
export function collectFlood(original, view, w, h, x, y, tolerance) {
  const ix = Math.max(0, Math.min(w - 1, Math.round(x)))
  const iy = Math.max(0, Math.min(h - 1, Math.round(y)))
  const seed = iy * w + ix
  if (view[seed * 4 + 3] === 0) return new Int32Array(0)

  const maxD2 = colorMatchLimit(tolerance)
  const sr = original[seed * 4]
  const sg = original[seed * 4 + 1]
  const sb = original[seed * 4 + 2]
  const n = w * h
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  const picked = []
  let head = 0
  let tail = 0
  seen[seed] = 1
  queue[tail++] = seed

  const consider = (i) => {
    if (seen[i] || view[i * 4 + 3] === 0) return
    const p = i * 4
    const dr = original[p] - sr
    const dg = original[p + 1] - sg
    const db = original[p + 2] - sb
    if (dr * dr + dg * dg + db * db > maxD2) return
    seen[i] = 1
    queue[tail++] = i
  }

  while (head < tail) {
    const i = queue[head++]
    picked.push(i)
    const px = i % w
    const py = (i - px) / w
    if (px > 0) consider(i - 1)
    if (px < w - 1) consider(i + 1)
    if (py > 0) consider(i - w)
    if (py < h - 1) consider(i + w)
  }
  return Int32Array.from(picked)
}

export function stampIndices(op, weight, indices, target, opGen = null, gen = 0) {
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k]
    op[i] = target
    weight[i] = 255
    if (gen > 0 && opGen) opGen[i] = gen
  }
}

function clamp8(v) {
  if (v < 0) return 0
  if (v > 255) return 255
  return Math.round(v)
}

/**
 * 把覆盖层叠到自动抠图结果上，写入 out（可与 auto / original 不同的缓冲区）。
 * rect 省略时处理整张图。软边按预乘颜色混合，避免半透明边缘发灰。
 */
export function applyMask(auto, original, op, weight, out, width, rect) {
  const height = op.length / width
  const x0 = rect ? rect.x : 0
  const y0 = rect ? rect.y : 0
  const x1 = rect ? Math.min(width, rect.x + rect.w) : width
  const y1 = rect ? Math.min(height, rect.y + rect.h) : height
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x
      const p = i * 4
      const kind = op[i]
      const wgt = weight[i]
      if (kind === OP_AUTO || wgt === 0) {
        out[p] = auto[p]
        out[p + 1] = auto[p + 1]
        out[p + 2] = auto[p + 2]
        out[p + 3] = auto[p + 3]
        continue
      }
      const t = wgt / 255
      const sa = auto[p + 3] / 255
      const sr = auto[p] * sa
      const sg = auto[p + 1] * sa
      const sb = auto[p + 2] * sa
      let da = 0
      let dr = 0
      let dg = 0
      let db = 0
      if (kind === OP_KEEP) {
        da = original[p + 3] / 255
        dr = original[p] * da
        dg = original[p + 1] * da
        db = original[p + 2] * da
      }
      const oa = sa * (1 - t) + da * t
      if (oa <= 1 / 255) {
        out[p] = 0
        out[p + 1] = 0
        out[p + 2] = 0
        out[p + 3] = 0
        continue
      }
      const inv = 1 / oa
      out[p] = clamp8((sr * (1 - t) + dr * t) * inv)
      out[p + 1] = clamp8((sg * (1 - t) + dg * t) * inv)
      out[p + 2] = clamp8((sb * (1 - t) + db * t) * inv)
      out[p + 3] = clamp8(oa * 255)
    }
  }
}

function stampFill(state, stroke, gen) {
  ensurePaint(state)
  const { x, y, w, h, pixels } = stroke
  for (let row = 0; row < h; row++) {
    const dy = y + row
    if (dy < 0 || dy >= state.h) continue
    for (let col = 0; col < w; col++) {
      const dx = x + col
      if (dx < 0 || dx >= state.w) continue
      const i = dy * state.w + dx
      const s = (row * w + col) * 4
      const p = i * 4
      state.paint[p] = pixels[s]
      state.paint[p + 1] = pixels[s + 1]
      state.paint[p + 2] = pixels[s + 2]
      state.paint[p + 3] = pixels[s + 3]
      state.paintGen[i] = gen
    }
  }
}

function applyCommitted(state, stroke) {
  const gen = state.seq
  if (stroke.kind === 'reset') {
    state.op.fill(0)
    state.weight.fill(0)
    if (state.opGen) state.opGen.fill(0)
    if (state.paintGen) state.paintGen.fill(0)
    return
  }
  if (stroke.kind === 'flood') {
    stampIndices(state.op, state.weight, stroke.indices, OP_ERASE, state.opGen, gen)
    return
  }
  if (stroke.kind === 'brush') applyBrushStroke(state, stroke, gen)
  if (stroke.kind === 'fill') stampFill(state, stroke, gen)
}

export function replayTouchup(state) {
  if (state.undo.some((stroke) => stroke.kind === 'fill')) ensurePaint(state)
  state.op.fill(0)
  state.weight.fill(0)
  if (state.opGen) state.opGen.fill(0)
  if (state.paintGen) state.paintGen.fill(0)
  state.seq = 0
  for (let i = 0; i < state.undo.length; i++) {
    state.seq += 1
    applyCommitted(state, state.undo[i])
  }
}

/** 自动抠图 + 擦除/还原 + 填充。rect 省略时处理整张图。 */
export function compositeTouchup(state, out, rect) {
  applyMask(state.auto, state.original, state.op, state.weight, out, state.w, rect)
  const paint = state.paint
  const paintGen = state.paintGen
  if (!paint || !paintGen) return
  const opGen = state.opGen
  const width = state.w
  const height = state.h
  const x0 = rect ? rect.x : 0
  const y0 = rect ? rect.y : 0
  const x1 = rect ? Math.min(width, rect.x + rect.w) : width
  const y1 = rect ? Math.min(height, rect.y + rect.h) : height
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x
      const g = paintGen[i]
      if (g === 0) continue
      const og = opGen ? opGen[i] : 0
      if (g <= og) continue
      const p = i * 4
      out[p] = paint[p]
      out[p + 1] = paint[p + 1]
      out[p + 2] = paint[p + 2]
      out[p + 3] = paint[p + 3]
    }
  }
}

export function commitStroke(state, stroke) {
  if (!stroke) return false
  if (stroke.kind === 'brush' && (!stroke.points || !stroke.points.length)) return false
  if (stroke.kind === 'flood' && (!stroke.indices || !stroke.indices.length)) return false
  if (
    stroke.kind === 'fill' &&
    (!stroke.pixels || !stroke.pixels.length || stroke.w < 1 || stroke.h < 1)
  )
    return false
  state.redo.length = 0
  state.undo.push(stroke)
  return true
}

export function undoTouchup(state) {
  const stroke = state.undo.pop()
  if (!stroke) return false
  state.redo.push(stroke)
  replayTouchup(state)
  return true
}

export function redoTouchup(state) {
  const stroke = state.redo.pop()
  if (!stroke) return false
  state.undo.push(stroke)
  replayTouchup(state)
  return true
}

/** 最后一笔如果是「清除」，当前没有生效的修边。 */
export function hasEdits(state) {
  for (let i = state.undo.length - 1; i >= 0; i--) {
    if (state.undo[i].kind === 'reset') return false
    return true
  }
  return false
}
