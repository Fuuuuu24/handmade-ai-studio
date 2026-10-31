# 正式代码

产品的正式实现（M2）。Next.js 项目，包名 `yijian`。

- **状态（2026-11-01）**：按 [技术写法](../docs/tech-design.md)（v0.3）第 10 节顺序开发，检查点 1—4 已完成；下一步是白底图两种做法（含阿里云抠图）。完成度清单和下一步见 [交接文档](../docs/handoff.md)。
- **技术栈**：Next.js 16 + React 19 + TypeScript + Tailwind 4 + shadcn/ui + motion + Vercel AI SDK 7；Dexie（IndexedDB）；Vitest、Playwright、ESLint、Prettier。版本见技术写法第 1 节。
- **注意**：Next.js 16 与 AI SDK 7 有破坏性变化，写法以 `node_modules/next/dist/docs/`、`node_modules/ai/docs/` 的本地文档为准。`AGENTS.md` 由 Next.js 自动生成，`next dev` 会重新写入，不要删。

## 运行

需要 Node.js 24。

```sh
npm install
npm run dev                    # http://localhost:3000，真实调用模型（花钱）
FAKE_GATEWAY=1 npm run dev     # 生图走假网关：不花钱，图片是测试图（只在开发环境生效）
npm test                       # 单元测试
npm run typecheck && npm run lint
```

密钥写在本目录 `.env.local`：`AIHUBMIX_API_KEY=...`；接入抠图后还要加 `ALIBABA_CLOUD_ACCESS_KEY_ID=...`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET=...`。该文件不入库，也不要写进代码、文档或对话。服务端花费账本在 `data/ledger.json`（运行时生成，不入库）。

原型（`../原型-v3/` 布局与交互、`../原型-v2/` 业务规则）用于对照，不应未经评审直接复制为正式代码。
