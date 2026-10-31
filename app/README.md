# Knowledge Canvas

纯 Web 的无限知识画布。对话和文档节点共享同一块画布，选中文档段落或模型回答可以从来源处继续追问。

## 开发

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:3000`。

## 模型接口

模型设置支持任意 OpenAI-compatible `/chat/completions` 接口。请求不会从浏览器直接发往第三方，而是发给同源的 `/api/chat`，由 Vite 开发中间件或 `server.mjs` 转发，因此不需要模型服务本身返回 CORS 头。

- Base URL 可以填 `https://api.example.com/v1`，也可以填完整的 `.../chat/completions`。
- API Key 只保存在当前标签页的 `sessionStorage`；本地模型服务可以不填。
- 代理不会把 Key 写入磁盘；但部署到公网时必须自行给 `/api/chat` 增加鉴权和访问控制。

## PaddleOCR

扫描 PDF 导入后不会删除文件，会保留页面并显示“没有可提取的文本层”。点击“运行 OCR”后逐页渲染 PDF、提交图片、按页保存识别文本，可在“页面 / 识别文本”之间切换，并从识别文本继续创建带页码的分支。

支持两种模式：

- **PaddleOCR 云端**：AI Studio Access Token，模型可选 `PP-OCRv6` / `PP-OCRv5`。请求经 `/api/ocr` 代理提交异步任务并轮询结果。
- **自建 PaddleOCR / PaddleX**：配置 `http://127.0.0.1:8080` 或完整的 `/ocr` 地址。代理会调用自建服务的 `POST /ocr`。

云端 Token 和自建服务 Token 都只保存在当前标签页。扫描 PDF 的 OCR 默认需要手动触发；设置里可以开启“导入扫描件后自动识别”，只处理没有文本层的页面。

## 生产运行

```bash
npm run build
npm start
```

`server.mjs` 同时提供静态文件、`/api/chat` 和 `/api/ocr`。默认监听 `127.0.0.1:4173`，可用 `HOST`、`PORT` 覆盖。

可选服务端环境变量：

```bash
cp .env.example .env
```

```dotenv
PADDLEOCR_ACCESS_TOKEN=
PADDLEOCR_BASE_URL=https://paddleocr.aistudio-app.com
```

浏览器设置中填写的 Token 优先于 `PADDLEOCR_ACCESS_TOKEN`。`PADDLEOCR_BASE_URL` 只建议在自建代理或测试环境覆盖。

## 验证

```bash
npm run lint
npm run build
```

OCR 和模型调用都依赖同源代理，不能只把 `dist/` 静态托管在普通文件服务器上使用这两项能力。
