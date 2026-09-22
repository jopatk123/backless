/**
 * 生成用于浏览器实测的测试图片（纯色背景 + 主体）
 * 用法: node scripts/make-test-images.mjs [输出目录]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const outDir = process.argv[2] || '/tmp/backless-test'
mkdirSync(outDir, { recursive: true })

// ---- 最小 PNG 编码器 ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(W, H, rgba) {
  const stride = W * 4
  const raw = Buffer.alloc((stride + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 图 1: 绿色背景 + 红色大圆 + 白色小圆（渐变背景） ----
{
  const W = 480,
    H = 360
  const px = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      let [r, g, b] = [10 + (x / W) * 14, 185 + (y / H) * 12, 75] // 渐变绿背景
      const d1 = Math.hypot(x - 220, y - 180)
      const d2 = Math.hypot(x - 300, y - 150)
      if (d1 <= 95) [r, g, b] = [222, 58, 62] // 红圆
      if (d2 <= 38) [r, g, b] = [255, 252, 240] // 白圆（红圆内部）
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  }
  writeFileSync(resolve(outDir, '绿色背景-圆形主体.png'), encodePNG(W, H, px))
}

// ---- 图 2: 蓝色纯背景 + 黄色五角星 ----
{
  const W = 420,
    H = 420
  const px = Buffer.alloc(W * H * 4)
  const cx = 210,
    cy = 210
  const pts = []
  for (let k = 0; k < 10; k++) {
    const ang = Math.PI / 2 + (k * Math.PI) / 5
    const R = k % 2 === 0 ? 165 : 66
    pts.push([cx + R * Math.cos(ang), cy - R * Math.sin(ang)])
  }
  const inStar = (x, y) => {
    let inside = false
    for (let i = 0, j = 9; i < 10; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const [r, g, b] = inStar(x, y) ? [255, 202, 36] : [28, 78, 190]
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  }
  writeFileSync(resolve(outDir, '蓝色背景-五角星.png'), encodePNG(W, H, px))
}

console.log(`已生成 2 张测试图 -> ${outDir}`)
