# Knowledge Canvas

以无限画布为核心的个人学习工作区。对话、文档和 Web 节点共享空间位置，来源与追问关系始终可见。

- 应用代码：[`app/`](./app)
- 产品需求与设计：[`docs/`](./docs)
- 当前后端：BYOK OpenAI-compatible API，经同源代理调用
- 文档：PDF、Markdown、TXT，可选 PaddleOCR
- Web 节点：ChatGPT / DeepSeek 真实网页会话的标签页联动；ChatGPT 新会话镜像按扩展适配状态开放

## 开发

```bash
cd app
npm install
npm run dev
```

打开 `http://127.0.0.1:3000`。

## 生产运行

```bash
cd app
npm run build
npm start
```

`app/server.mjs` 同时提供静态文件、`/api/chat`、`/api/ocr` 和扩展消息所需的同源服务。部署到公网前必须给代理接口增加鉴权和访问控制。

## 文档

- [产品需求](docs/product-requirements.md)
- [无限画布设计](docs/infinite-canvas-design.md)
- [Web 节点技术设计](docs/web-node-technical-design.md)
- [执行后端评估](docs/execution-backend-evaluation.md)

## 验证

```bash
cd app
npm run lint
npm run build
```
