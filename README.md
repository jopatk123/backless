# Backless · 智能抠图

批量去除图片纯色背景的浏览器工具。全部处理在本地完成（Web Worker），**图片不会上传到任何服务器**。

## 功能特性

- **批量处理**：拖拽 / 点选多张图片，一次性完成抠图
- **自动识别背景色**：从四周边框像素投票得出背景参考色；也可在原图上吸色，取点击处一小块的平均色作为参考色
- **边缘泛洪算法**：只移除与边缘连通的相似色区域，不会误删主体内部与背景同色的部分
- **容差 / 羽化可调**：全局设置实时重新处理，边缘过渡自然；也可在对比弹窗里对单张图片开启「自定义参数」，开启后该图独立于全局设置
- **手动修边**：在结果上擦掉残留，或把误删的主体涂回；也可点一下清掉一块没连到边缘的同色区域。框选后可用周围颜色填充，适合去掉小块水印。擦除和填充的预览就是最终效果。`+` / `-` 放大缩小，空格拖移。修改记在覆盖层上，之后再调容差、羽化或吸色也不会丢
- **对比预览**：原图 / 结果左右滑动对比
- **打包下载**：单张下载 PNG，或 ZIP 打包全部结果

## 技术栈

- [Vue 3](https://vuejs.org/)（Composition API + `<script setup>`）
- [Vite 7](https://vite.dev/)
- 原生 Web Worker（抠图算法不阻塞 UI）
- [JSZip](https://stuk.github.io/jszip/)（结果打包）

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 生产构建（输出到 dist/）
npm run build

# 本地预览构建产物
npm run preview
```

## 质量保障

```bash
npm test           # 抠图算法单元测试（Node 直接运行，无 DOM 依赖）
npm run lint       # ESLint 检查（Vue + JS）
npm run format     # Prettier 格式化
npm run format:check
```

行数预算（由 ESLint 强制）：常规文件有效行数 **> 600 行警告、> 800 行报错**，详见 `AGENTS.md`。

## CI / CD

- **CI**（`.github/workflows/ci.yml`）：push / PR 时自动执行 lint、格式检查、测试与构建
- **Pages 部署**（`.github/workflows/deploy.yml`）：`main` 分支 push 后自动构建并发布到 GitHub Pages
  （首次使用需在仓库 Settings → Pages 中将 Source 设为 **GitHub Actions**）

## 项目结构

```text
├── src/
│   ├── App.vue                  # 主界面：上传、参数控制、下载
│   ├── components/
│   │   ├── Dropzone.vue         # 空态上传区
│   │   ├── ImageCard.vue        # 单图卡片
│   │   ├── CompareModal.vue     # 原图/结果对比弹窗（支持吸色）
│   │   ├── ColorLoupe.vue       # 吸色时跟随光标的取样色预览
│   │   ├── TouchupCanvas.vue    # 修边画布：笔刷、缩放、平移
│   │   └── TouchupBar.vue       # 修边工具栏
│   ├── lib/
│   │   ├── matting.js           # 抠图核心算法（纯函数，无 DOM 依赖）
│   │   ├── touchup.js           # 修边覆盖层（笔刷、泛洪、填充、撤销重放）
│   │   ├── inpaint.js           # 矩形填充：从边缘向内扩散周围颜色
│   │   ├── fillStroke.js        # 把一次填充记进撤销栈
│   │   ├── touchupZoom.js       # 修边画布的缩放与平移
│   │   ├── matting.worker.js    # Worker：持有像素数据并执行处理
│   │   └── mattingService.js    # 主线程 <-> Worker 的 Promise 封装
│   └── style.css                # 全局样式与通用按钮/动画
├── scripts/
│   ├── test-matting.mjs         # 抠图算法单元测试
│   ├── test-touchup.mjs         # 修边覆盖层单元测试
│   ├── test-inpaint.mjs         # 矩形填充单元测试
│   └── make-test-images.mjs     # 生成浏览器实测用测试图
└── .github/workflows/           # CI 与 Pages 部署
```

## 算法说明

1. **背景色识别**：采样四周边框像素，量化到 16 级/通道后多数投票，抗噪。手动吸色取点击处 5×5 不透明像素的平均色，避免单点噪点把参考色带偏
2. **泛洪去背**：以参考色为中心、按容差（映射为 RGB 欧氏距离）从四边播种做 BFS 泛洪，仅移除与边缘连通的区域
3. **边缘羽化**：对预乘颜色 + alpha 做可分离盒式模糊后还原，消除背景色镶边
4. **手动修边**：每张图另有一张覆盖层（交给自动抠图 / 强制擦除 / 强制保留，软边带权重），填充再记一层颜色。谁后画谁生效。笔刷、「擦这块」和矩形填充都进撤销栈，按整笔重放。调参重算后这些修改仍然生效。填充从选区边缘向内，用周围像素做加权平均
