import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUDGET } from '@/config/budget';
import { attachRef, budgetSummary, refund, reserve, settle } from './ledger';
import { BudgetError } from './errors';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yijian-ledger-'));
  process.env.LEDGER_PATH = path.join(dir, 'ledger.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.LEDGER_PATH;
});

describe('花费账本（PRD 4.2 第 4 条）', () => {
  it('预留按估价计入，结算后按实际计入，退回后不计', async () => {
    const a = await reserve('image', 'img-a', 0.05);
    const b = await reserve('chat', 'chat-a', 0.01);
    expect((await budgetSummary()).spentUSD).toBeCloseTo(0.06, 10);
    await settle(b.id, 0.002);
    expect((await budgetSummary()).spentUSD).toBeCloseTo(0.052, 10);
    await attachRef(a.id, 'task_1');
    await refund(a.id, 'task_1');
    expect((await budgetSummary()).spentUSD).toBeCloseTo(0.002, 10);
  });

  it('退回只认对得上的任务编号；已结算的不能退', async () => {
    const a = await reserve('image', 'img-a', 0.05);
    await attachRef(a.id, 'task_1');
    await refund(a.id, 'task_other');
    expect((await budgetSummary()).spentUSD).toBeCloseTo(0.05, 10);
    const b = await reserve('chat', 'chat-a', 0.01);
    await settle(b.id, 0.01);
    await refund(b.id);
    expect((await budgetSummary()).spentUSD).toBeCloseTo(0.06, 10);
  });

  it('超过总预算拒绝调用，不记账', async () => {
    await reserve('image', 'img-a', BUDGET.totalUSD - 0.01);
    await expect(reserve('image', 'img-a', 0.05)).rejects.toBeInstanceOf(BudgetError);
    expect((await budgetSummary()).remainingUSD).toBeCloseTo(0.01, 10);
  });

  it('并发预留不会超过预算（串行读写）', async () => {
    const each = BUDGET.totalUSD / 4;
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => reserve('image', 'img-a', each)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect((await budgetSummary()).spentUSD).toBeCloseTo(BUDGET.totalUSD, 10);
  });

  it('账本文件损坏时报错，不当作空账本继续花钱', async () => {
    writeFileSync(process.env.LEDGER_PATH!, '{不是 JSON');
    await expect(reserve('chat', 'chat-a', 0.01)).rejects.toThrow('花费账本读不出来');
  });
});
