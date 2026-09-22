/**
 * 抠图 Worker：持有每张图的原始像素（主线程不留副本），
 * 按请求 id 回传结果，避免并发时串包。
 */
import { detectEdgeColor, processMatting } from './matting.js'

const store = new Map()

function normalizeColor(color) {
  if (!color || color.length < 3) return null
  const r = +color[0]
  const g = +color[1]
  const b = +color[2]
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return [r, g, b]
}

self.onmessage = (e) => {
  const msg = e.data
  const reply = (payload, transfer) => {
    self.postMessage({ ...payload, id: msg.id, reqId: msg.reqId }, transfer || [])
  }
  try {
    switch (msg.type) {
      case 'register': {
        const data = new Uint8ClampedArray(msg.buffer)
        const autoColor = detectEdgeColor(data, msg.w, msg.h)
        store.set(msg.id, { data, w: msg.w, h: msg.h, autoColor })
        reply({ type: 'registered', autoColor })
        break
      }
      case 'process': {
        const rec = store.get(msg.id)
        if (!rec) {
          reply({ type: 'error', error: '图片数据已失效，请重新添加' })
          break
        }
        const picked = normalizeColor(msg.pickedColor)
        const out = processMatting(rec.data, rec.w, rec.h, {
          tolerance: msg.tolerance,
          feather: msg.feather,
          refColor: picked || rec.autoColor,
        })
        reply({ type: 'done', buffer: out.buffer, w: rec.w, h: rec.h }, [out.buffer])
        break
      }
      case 'sample': {
        const rec = store.get(msg.id)
        if (!rec) {
          reply({ type: 'error', error: '吸色失败' })
          break
        }
        const x = Math.max(0, Math.min(rec.w - 1, msg.x | 0))
        const y = Math.max(0, Math.min(rec.h - 1, msg.y | 0))
        const p = (y * rec.w + x) * 4
        reply({ type: 'sampled', color: [rec.data[p], rec.data[p + 1], rec.data[p + 2]] })
        break
      }
      case 'unregister': {
        store.delete(msg.id)
        break
      }
      default:
        break
    }
  } catch (err) {
    if (msg && msg.reqId != null) {
      reply({ type: 'error', error: (err && err.message) || '处理失败' })
    }
  }
}
