// 花费估算与预算检查（PRD 4.2 第 4 条）。价格来自 config/models.ts，这里只做计算。

export interface ChatPricing {
  inputPerMTok: number; // 美元／百万输入 token
  outputPerMTok: number;
}

export const chatCost = (p: ChatPricing, usage: { inputTokens: number; outputTokens: number }) =>
  (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1e6;

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

export function budgetCheck(spentUSD: number, estUSD: number, totalUSD: number): BudgetCheck {
  if (estUSD < 0 || !Number.isFinite(estUSD)) return { ok: false, reason: '花费估算无效' };
  if (spentUSD + estUSD > totalUSD) {
    return { ok: false, reason: `已到预算上限：已花 ${spentUSD.toFixed(2)} 美元，总额 ${totalUSD} 美元` };
  }
  return { ok: true };
}

export function imageCostCheck(perImageUSD: number, maxImageUSD: number): BudgetCheck {
  return perImageUSD > maxImageUSD
    ? { ok: false, reason: `这个模型单张约 ${perImageUSD} 美元，超过单张上限 ${maxImageUSD} 美元` }
    : { ok: true };
}
