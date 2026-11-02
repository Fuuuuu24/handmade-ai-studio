// 凭据统一管理（技术写法第 12 节）。本文件不 import 任何东西：管理后台也用 Node 直接加载它。
export const CREDENTIALS = {
  // 替换 key 后，上一把再保留多久，只用来查询和取回替换前提交的生图（AIHubMix 的任务按创建它的 key 隔离）
  previousKeyGraceHours: 24,
  // 协作者本地（relay 模式）查询服务器转发是否可用的超时
  relayStatusTimeoutMs: 3000,
  // 转发请求体上限：8 张 2048px 参考图转成 base64 的量级（config/upload.ts），部署时按实测再调
  relayMaxBodyBytes: 32 * 1024 * 1024,
};
