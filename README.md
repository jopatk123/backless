# Backless · 智能抠图

批量去除图片纯色背景的浏览器工具。全部处理在本地完成（Web Worker），**图片不会上传到任何服务器**。

## 功能特性

- **批量处理**：拖拽 / 点选多张图片，一次性完成抠图
- **自动识别背景色**：从四周边框像素投票得出背景参考色，也支持手动吸色指定
- **边缘泛洪算法**：只移除与边缘连通的相似色区域，不会误删主体内部与背景同色的部分
- **容差 / 羽化可调**：实时重新处理，边缘过渡自然
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

```
├── src/
│   ├── App.vue                  # 主界面：上传、参数控制、下载
│   ├── components/
│   │   ├── Dropzone.vue         # 空态上传区
│   │   ├── ImageCard.vue        # 单图卡片
│   │   └── CompareModal.vue     # 原图/结果对比弹窗（支持吸色）
│   ├── lib/
│   │   ├── matting.js           # 抠图核心算法（纯函数，无 DOM 依赖）
│   │   ├── matting.worker.js    # Worker：持有像素数据并执行处理
│   │   └── mattingService.js    # 主线程 <-> Worker 的 Promise 封装
│   └── style.css                # 全局样式与通用按钮/动画
├── scripts/
│   ├── test-matting.mjs         # 算法单元测试
│   └── make-test-images.mjs     # 生成浏览器实测用测试图
└── .github/workflows/           # CI 与 Pages 部署
```

## 算法说明

1. **背景色识别**：采样四周边框像素，量化到 16 级/通道后多数投票，抗噪
2. **泛洪去背**：以参考色为中心、按容差（映射为 RGB 欧氏距离）从四边播种做 BFS 泛洪，仅移除与边缘连通的区域
3. **边缘羽化**：对预乘颜色 + alpha 做可分离盒式模糊后还原，消除背景色镶边
