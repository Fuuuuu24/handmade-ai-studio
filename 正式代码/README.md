# 正式代码

产品的正式实现（M2）。Next.js 项目，包名 `yijian`。

- **状态（2026-11-01）**：按 [技术写法](../docs/tech-design.md)（v0.5）第 10 节顺序开发，检查点 1—8 的业务代码已完成，React Bits 组件已接入，已随 PR #6 合并进上游 `main`；凭据统一管理（第 12 节）已在本地实现并提交（未推送）；抠图按发起人决定先不接。下一步是在产品里用真实饰品测模型（花钱，待发起人同意）。已做／待做／未做见 [交接文档](../docs/handoff.md) 第 4—6 节。
- **技术栈**：Next.js 16 + React 19 + TypeScript + Tailwind 4 + motion + Vercel AI SDK 7；Dexie（IndexedDB）；Vitest、Playwright、ESLint、Prettier（装了、未配置）。界面组件来自 React Bits，手动拷在 `src/components/bits/`（第三方许可，见该目录 LICENSE 与 README；shadcn 没初始化）。版本见技术写法第 1 节。
- **注意**：Next.js 16 与 AI SDK 7 有破坏性变化，写法以 `node_modules/next/dist/docs/`、`node_modules/ai/docs/` 的本地文档为准。`AGENTS.md` 由 Next.js 自动生成，`next dev` 会重新写入，不要删。

## 运行

需要 Node.js 24。

```sh
npm install
npm run dev                    # http://localhost:3000，真实调用模型（花钱）
FAKE_GATEWAY=1 FAKE_CHAT=1 npm run dev   # 生图和对话都是假的：不花钱（只在开发环境生效）；对话里用「【测试：xxx】」标记驱动小间
TRIAL_OPERATOR=1 npm run dev             # 试用操作员：资产页显示 A/B 路线开关、顶栏显示预算余量
npm test                       # 单元测试
npm run typecheck && npm run lint
npm run e2e                    # 全流程测试（Playwright，用本机 Chrome；自己起 3100 端口的开发服务器）
```

密钥写在本目录 `.env.local`：`AIHUBMIX_API_KEY=...`（抠图暂不接，接了再加对应密钥）。该文件不入库，也不要写进代码、文档或对话。服务端花费账本在 `data/ledger.json`（运行时生成，不入库）。

凭据来源用 `CREDENTIAL_SOURCE` 选，三种互不回退（[技术写法](../docs/tech-design.md)第 12 节）：

- `env`（不设时的默认）：用上面的 `AIHUBMIX_API_KEY`，和以前一样。正式上线前本地开发用这个。
- `file`：服务器上用。读管理后台写的加密凭据文件，要设 `CREDENTIALS_PATH` 和 `CREDENTIALS_MASTER_KEY`；不再放 `AIHUBMIX_API_KEY`。
- `relay`：协作者本地用，正式上线后本地开发也统一用它。请求经服务器转发，用发起人在后台管理的那套 key；在 `.env.local` 写 `CREDENTIAL_SOURCE=relay`、`MODEL_RELAY_URL=`（服务器地址，比如 `https://example.com`，不带路径）、`MODEL_RELAY_TOKEN=`（团队口令），后两项找发起人私下要，不进仓库。只能用服务器配置里有的模型，花费记在服务器账本。

原型（`../原型-v3/` 布局与交互）用于对照，不应未经评审直接复制为正式代码。
