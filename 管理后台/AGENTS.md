# 管理后台协作边界

修改此目录前，读 `prd/PRD.md` 与 `prd/技术方案.md`；验证和已知限制见 `prd/验收记录.md`。

- 主产品 `../正式代码` 是只读来源。只能读取固定的 instructions.ts、white.ts、models.ts，以及凭据用的 `src/server/credential-file.ts`（格式与加解密，两边共用）和 `src/config/credentials.ts`（v1.1）；禁止写主产品源码与配置、调用模型。唯一的写入例外是服务器上的凭据文件（`CREDENTIALS_PATH`），范围见 `prd/PRD.md` v1.1「供应商与凭据」；超出这个范围接入主产品，先确认新的授权范围。部署需本轮明确授权。
- key 只写不读回：任何接口、日志、导出、`data/state.json` 和浏览器存储都不得出现 key 的原文或密文（`credentials.mjs`，已实现，测试在 `tests/credentials.test.mjs`）。凭据测试只用临时目录、临时主密钥和假 key。
- 保留 `prd/`、`原型/`、`正式代码/`。本项目采用 Node 24 原生服务，无外部依赖。
- 原型是静态快照与 localStorage 演示；正式版从来源读取，保存在自己的 `data/state.json`。不得混淆生效范围。
- 同步更新未编辑项，保留后台修改和来源删除项。存储写入需串行、revision 校验与原子替换；坏数据必须报错，禁止自动重置。
- 原型与正式前端是独立交付副本；修改交互时检查两份 app.js/styles.css 是否一致，正式版 HTML 不设置 PROTOTYPE。
- 检查运行 `正式代码/npm run check` 与 `npm test`；界面验证只用原生 CUA。测试数据仅放后台自己的临时目录，用完清理。不要触碰其他代理正在修改的主代码。
- 未获本轮明确授权，不提交、推送或部署。
