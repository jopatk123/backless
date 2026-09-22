/** 修边画布的缩放与平移（相对「适应画面」的倍数）。 */

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 8

export function clampPan(pan, zoom, sw, sh) {
  const mx = Math.min(48, sw * 0.25)
  const my = Math.min(48, sh * 0.25)
  pan.x = Math.min(sw - mx, Math.max(mx - sw * zoom, pan.x))
  pan.y = Math.min(sh - my, Math.max(my - sh * zoom, pan.y))
}

/** 图像坐标里的选框，换成相对画布容器的 CSS 像素。 */
export function selectionFrame(canvas, stage, imageW, imageH, x0, y0, x1, y1) {
  const sx = canvas.width / imageW
  const sy = canvas.height / imageH
  const left = Math.min(x0, x1)
  const top = Math.min(y0, y1)
  return {
    x: canvas.left - stage.left + left * sx,
    y: canvas.top - stage.top + top * sy,
    w: Math.abs(x1 - x0) * sx,
    h: Math.abs(y1 - y0) * sy,
  }
}

/** 以画面坐标 (cx, cy) 为中心缩放，并改写 pan。返回新的倍数。 */
export function zoomAtPoint(pan, zoom, cx, cy, factor) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))
  if (next === zoom) return zoom
  const k = next / zoom
  pan.x = cx - (cx - pan.x) * k
  pan.y = cy - (cy - pan.y) * k
  return next
}
