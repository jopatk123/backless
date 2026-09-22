import { inpaintRect, selectionRect } from './inpaint.js'
import { commitStroke, replayTouchup } from './touchup.js'

const reasons = {
  small: '框选区域太小',
  large: '选区太大，请只框住要去掉的一小块',
  full: '请留出选区外的颜色，填充才能参考',
}

/** 把当前画面上的矩形填充记成一笔。失败时返回提示文案。 */
export function commitInpaint(state, view, x0, y0, x1, y1) {
  const picked = selectionRect(x0, y0, x1, y1, state.w, state.h)
  if (picked.error) return reasons[picked.error]
  const pixels = inpaintRect(view, state.w, state.h, picked)
  if (!pixels) return '这里没有周围颜色可参考'
  commitStroke(state, {
    kind: 'fill',
    x: picked.x,
    y: picked.y,
    w: picked.w,
    h: picked.h,
    pixels,
  })
  replayTouchup(state)
  return ''
}
