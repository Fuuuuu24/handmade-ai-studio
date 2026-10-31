import { describe, expect, it } from 'vitest';
import { budgetCheck, chatCost, imageCostCheck } from './cost';

describe('花费', () => {
  it('按输入输出 token 计算对话费用', () => {
    expect(chatCost({ inputPerMTok: 0.2, outputPerMTok: 0.8 }, { inputTokens: 10_000, outputTokens: 1_000 })).toBeCloseTo(
      0.0028,
      10,
    );
  });

  it('超过总预算拒绝，并说明已花多少', () => {
    expect(budgetCheck(68.9, 0.05, 69)).toEqual({ ok: true });
    expect(budgetCheck(68.98, 0.05, 69)).toEqual({ ok: false, reason: '已到预算上限：已花 68.98 美元，总额 69 美元' });
    expect(budgetCheck(0, Number.NaN, 69)).toEqual({ ok: false, reason: '花费估算无效' });
  });

  it('单张估价超过上限的模型不允许调用', () => {
    expect(imageCostCheck(0.04, 0.3)).toEqual({ ok: true });
    expect(imageCostCheck(0.5, 0.3)).toMatchObject({ ok: false });
  });
});
