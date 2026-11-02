// 花费与次数上限（PRD 4.2 第 4 条、O4）。总额按 500 元、汇率 7.2 折算。
// 单张上限、补齐次数、对话上限是暂定值，按产品内实测调整（O4：由 M2 实测后提出）。
export const BUDGET = {
  totalUSD: 69,
  maxImageUSD: 0.3, // 单张估价超过这个值的模型不允许调用
  retriesPerSlot: 2, // 每张候选失败后最多补齐几次
  chat: {
    maxSteps: 8, // 单轮里小间最多连续调用几次工具
    maxOutputTokens: 1500,
    retries: 2, // 对话失败后界面上的重试次数
    // 超时：本机网络慢时一轮要 14—70 秒（交接文档第 10 节），留足余量；超时后如实报错，可重试
    firstChunkMs: 75_000,
    totalMs: 150_000,
  },
};

export const CANDIDATES_PER_ROUND = 2;

// 生图任务轮询：网关建议 15 秒查一次，这里取 6 秒让界面更及时；等太久按失败处理，可补齐
export const GENERATION = {
  pollMs: 6000,
  timeoutMs: 10 * 60 * 1000,
  maxPollErrors: 10, // 连续查询失败（断网等）超过这个次数才判失败
  downloadTries: 3, // 生成好了但取回图片遇到临时错误时最多试几次；网关每个文件最多下载 3 次
};
