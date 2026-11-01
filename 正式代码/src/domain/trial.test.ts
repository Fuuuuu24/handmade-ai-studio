import { describe, expect, it } from 'vitest';
import { result } from '@/test/fixtures';
import { promptedWork } from '@/test/fixtures';
import { deletedRow, toCsv, trialRow, TRIAL_COLUMNS } from './trial';
import type { TrialEvent } from './types';

const ev = (type: string, workId: string | undefined, at: number, data?: TrialEvent['data']): TrialEvent => ({ id: `e${at}`, type, workId, at, data });

describe('试用记录（PRD 6.2、AC-10.4）', () => {
  it('从本地数据算出评价、修改、导出和发布，观察者要填的列留空', () => {
    const { work, assets } = promptedWork();
    const w = { ...work, costUSD: 0.0812 };
    const a = { ...result(w.id, 1, 0, { real: 'ok', style: 'ok' }), exports: [1], published: 2 };
    const b = { ...result(w.id, 1, 1, { real: 'bad', style: 'ok' }), issues: ['轮廓'], note: '链子变长了' };
    const events = [ev('create_work', w.id, 0), ev('upload', w.id, 1000), ev('picks', w.id, 2000), ev('revise', w.id, 3000), ev('retry', w.id, 4000), ev('export', w.id, 600_000), ev('upload', 'other', 9_000_000)];
    const row = trialRow('T-AB12', 1, { work: w, assets, tasks: [], results: [a, b] }, [], events, new Set());
    expect(row).toMatchObject({
      匿名编号: 'T-AB12',
      饰品类型: '耳饰',
      是否转选卡: '是（1 次）',
      白底路线: 'B',
      候选图数: '2',
      还原度与风格评价: '像实物 1、不像 1；风格对 2、不对 0；问题：轮廓；原话：链子变长了',
      修改与补图次数: '修改 1，补齐 1，加照片 0',
      '耗时（分钟）': '10',
      '累计成本（美元）': '0.0812',
      导出: '1 张（两项通过 1 张）',
      实际发布: '1 张',
      布景复用: '用了内置模版',
      发布渠道: '',
      人工帮助: '',
      建议: '',
    });
  });

  it('不导出作品名和聊天原文', () => {
    const { work, assets } = promptedWork();
    const row = trialRow('T-1', 1, { work: { ...work, name: '外婆的耳环' }, assets, tasks: [], results: [] }, [], [], new Set());
    expect(Object.values(row).join('|')).not.toContain('外婆的耳环');
  });

  it('删除的作品汇总成一行，花费不漏算', () => {
    const row = deletedRow('T-1', [ev('delete_work', undefined, 1, { costUSD: 0.1 }), ev('delete_work', undefined, 2, { costUSD: 0.05 })]);
    expect(row).toMatchObject({ 作品序号: '已删除 2 件', '累计成本（美元）': '0.1500' });
    expect(deletedRow('T-1', [])).toBeNull();
  });

  it('CSV 带 BOM，含逗号、引号和换行的格子会转义', () => {
    const row = Object.fromEntries(TRIAL_COLUMNS.map((c) => [c, ''])) as Parameters<typeof toCsv>[0][number];
    const csv = toCsv([{ ...row, 建议: '要"更亮",\n再试' }]);
    expect(csv.startsWith('﻿匿名编号,')).toBe(true);
    expect(csv).toContain('"要""更亮"",\n再试"');
  });
});
