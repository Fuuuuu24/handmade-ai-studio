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
  },
};

export const CANDIDATES_PER_ROUND = 2;
