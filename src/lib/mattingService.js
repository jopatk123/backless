/**
 * 主线程 <-> Worker 的 Promise 封装。
 * 每条请求带 reqId，响应对应回传，不会因为某次发送失败而卡住后续任务。
 */

function plainColor(color) {
  if (color == null) return null
  const r = +color[0]
  const g = +color[1]
  const b = +color[2]
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return [Math.round(r), Math.round(g), Math.round(b)]
}

export function createMattingService() {
  const worker = new Worker(new URL('./matting.worker.js', import.meta.url), {
    type: 'module',
  })

  let seq = 0
  /** @type {Map<number, {id: number, resolve: Function, reject: Function}>} */
  const waiters = new Map()

  const settle = (reqId, err, value) => {
    const waiter = waiters.get(reqId)
    if (!waiter) return
    waiters.delete(reqId)
    if (err) waiter.reject(err)
    else waiter.resolve(value)
  }

  worker.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'error') settle(msg.reqId, new Error(msg.error || '处理失败'))
    else settle(msg.reqId, null, msg)
  }

  worker.onerror = (e) => {
    const err = new Error(e.message || '抠图线程异常')
    for (const reqId of [...waiters.keys()]) settle(reqId, err)
  }

  function call(payload, transfer) {
    const reqId = ++seq
    return new Promise((resolve, reject) => {
      waiters.set(reqId, { id: payload.id, resolve, reject })
      try {
        if (transfer) worker.postMessage({ ...payload, reqId }, transfer)
        else worker.postMessage({ ...payload, reqId })
      } catch (err) {
        waiters.delete(reqId)
        reject(err)
      }
    })
  }

  function dropImage(id, reason) {
    for (const [reqId, waiter] of waiters) {
      if (waiter.id === id) settle(reqId, new Error(reason))
    }
  }

  return {
    /** 注册图片像素（transfer，主线程副本被转移），返回自动识别的背景色 */
    register(id, imageData) {
      return call(
        {
          type: 'register',
          id,
          buffer: imageData.data.buffer,
          w: imageData.width,
          h: imageData.height,
        },
        [imageData.data.buffer]
      ).then((msg) => msg.autoColor)
    },

    /** 按当前设置重新抠图，返回 { buffer, w, h } */
    process(id, { tolerance, feather, pickedColor }) {
      return call({
        type: 'process',
        id,
        tolerance,
        feather,
        pickedColor: plainColor(pickedColor),
      }).then((msg) => ({ buffer: msg.buffer, w: msg.w, h: msg.h }))
    },

    /** 取原图 (x, y) 处像素颜色（用于吸管） */
    sample(id, x, y) {
      return call({ type: 'sample', id, x, y }).then((msg) => msg.color)
    },

    /** 释放该图的原始像素，并作废尚未返回的请求 */
    release(id) {
      dropImage(id, '已移除')
      worker.postMessage({ type: 'unregister', id })
    },

    dispose() {
      for (const reqId of [...waiters.keys()]) settle(reqId, new Error('已关闭'))
      worker.terminate()
    },
  }
}
