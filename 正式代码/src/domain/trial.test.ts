import { describe, expect, it } from 'vitest';
import { backdrop, promptedWork, result, task, upload, viewTask } from '@/test/fixtures';
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
    // 正面三视图重做过一次（第一次没生成出来），这件作品还生成过两张背景、沉淀了一张
    const tasks = [viewTask(w.id, 'front', 'p1', 'failed'), viewTask(w.id, 'front', 'p1', 'succeeded'), viewTask(w.id, 'side', 'p2', 'succeeded'), task(w.id, 1, 0, 'succeeded')];
    const backdrops = [backdrop(w.id, 1, 0, { savedAt: 9 }), backdrop(w.id, 1, 1)];
    const row = trialRow('T-AB12', 1, { work: w, assets, tasks, results: [a, b], backdrops }, [], events);
    expect(row).toMatchObject({
      匿名编号: 'T-AB12',
      饰品类型: '耳饰',
      是否转选卡: '是（1 次）',
      流程: '首页开始；用模板库里的背景',
      三视图重做次数: '1',
      背景张数: '2',
      候选图数: '2',
      还原度与风格评价: '像实物 1、不像 1；风格对 2、不对 0；问题：轮廓；原话：链子变长了',
      小间代点: '没有',
      修改与补图次数: '修改 1，补齐 1，加照片 0',
      '耗时（分钟）': '10',
      '累计成本（美元）': '0.0812',
      导出: '1 张（两项通过 1 张）',
      实际发布: '1 张',
      '背景沉淀／复用': '用了内置模板；沉淀了 1 张',
      发布渠道: '',
      人工帮助: '',
      建议: '',
    });
  });

  it('小间问过用户后代点的次数按种类写，分得出验收是谁点的（技术写法 14.4）', () => {
    const { work, assets } = promptedWork();
    const proxy = (at: number, action: string) => ev('proxy', work.id, at, { action, by: 'agent' });
    const events = [proxy(1, 'confirm_view'), proxy(2, 'confirm_view'), proxy(3, 'verdict'), ev('proxy', 'other', 4, { action: 'verdict', by: 'agent' })];
    const row = trialRow('T-1', 1, { work, assets, tasks: [], results: [], backdrops: [] }, [], events);
    expect(row.小间代点).toBe('3 次（三视图 2、验收 1）');
  });

  it('不导出作品名和聊天原文', () => {
    const { work, assets } = promptedWork();
    const row = trialRow('T-1', 1, { work: { ...work, name: '外婆的耳环' }, assets, tasks: [], results: [], backdrops: [] }, [], []);
    expect(Object.values(row).join('|')).not.toContain('外婆的耳环');
  });

  it('背景用的是自己生成的、还是模板库里别的作品沉淀的', () => {
    const { work, assets } = promptedWork();
    const own = backdrop(work.id, 1, 0);
    const row = (w: typeof work) => trialRow('T-1', 1, { work: w, assets: [...assets, upload(w.id, 'detail')], tasks: [], results: [], backdrops: [own] }, [], [])['背景沉淀／复用'];
    expect(row({ ...work, backdropId: own.id, backdropMode: 'generate' })).toBe('用了自己生成的');
    expect(row({ ...work, backdropId: 'bd_other' })).toBe('用了模板库里沉淀的');
    expect(row({ ...work, backdropId: null })).toBe('还没选背景');
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
