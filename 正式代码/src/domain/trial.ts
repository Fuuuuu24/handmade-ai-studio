import { UPLOAD } from '@/config/upload';
import { passed } from './generation';
import { activeUploads } from './snapshot';
import type { Approval, Asset, Result, Task, TrialEvent, Work } from './types';

/* 试用记录（PRD 6.2 单人记录模板、AC-10.4）：从本地数据自动算出能算的列，需要观察者填的列留空。
   用匿名编号，不导出作品名、聊天原文和照片。 */

export const TRIAL_COLUMNS = [
  '匿名编号',
  '作品序号',
  '饰品类型',
  '发布渠道',
  '现用办法',
  '照片问题',
  '共创摘要',
  '是否转选卡',
  '方案／比例',
  '白底路线',
  '候选图数',
  '还原度与风格评价',
  '修改与补图次数',
  '耗时（分钟）',
  '人工帮助',
  '累计成本（美元）',
  '导出',
  '实际发布',
  '布景复用',
  '建议',
] as const;

export type TrialRow = Record<(typeof TRIAL_COLUMNS)[number], string>;

export interface TrialWork {
  work: Work;
  assets: readonly Asset[];
  tasks: readonly Task[];
  results: readonly Result[];
}

const count = (events: readonly TrialEvent[], type: string) => events.filter((e) => e.type === type).length;

export function trialRow(anonId: string, index: number, w: TrialWork, approvals: readonly Approval[], events: readonly TrialEvent[], savedSceneIds: ReadonlySet<string>): TrialRow {
  const { work, results } = w;
  const ev = events.filter((e) => e.workId === work.id).sort((a, b) => a.at - b.at);
  const uploads = activeUploads(w.assets, work.id);
  const small = uploads.filter((a) => Math.max(a.width, a.height) < UPLOAD.lowEdge).length;
  const mine = approvals.filter((a) => a.workId === work.id).sort((a, b) => a.version - b.version);
  const last = mine.at(-1);
  const realOk = results.filter((r) => r.verdict.real === 'ok').length;
  const realBad = results.filter((r) => r.verdict.real === 'bad').length;
  const styleOk = results.filter((r) => r.verdict.style === 'ok').length;
  const styleBad = results.filter((r) => r.verdict.style === 'bad').length;
  const issues = [...new Set(results.flatMap((r) => r.issues))];
  const notes = results.map((r) => r.note.trim()).filter(Boolean);
  const picks = count(ev, 'picks');
  const minutes = ev.length > 1 ? Math.round((ev.at(-1)!.at - ev[0].at) / 60000) : 0;
  const scene = !work.sceneId ? '没用布景' : savedSceneIds.has(work.sceneId) ? '用了自己存的布景' : '用了内置模版';
  const saves = count(ev, 'save_scene');

  return {
    匿名编号: anonId,
    作品序号: String(index),
    饰品类型: work.info.category.value || (work.info.category.unknown ? '未知' : ''),
    发布渠道: '',
    现用办法: '',
    照片问题: `照片 ${uploads.length} 张${small ? `，尺寸偏小 ${small} 张` : ''}`,
    共创摘要: work.story.summary ? `${work.story.summary.express}（${work.story.summaryState === 'confirmed' ? '已确认' : '草稿'}）` : work.story.noStory ? '暂无明确故事' : '',
    是否转选卡: picks ? `是（${picks} 次）` : '否',
    '方案／比例': last ? `第 ${last.version} 版／${last.snapshot.ratio}` : '没有批准',
    白底路线: work.route,
    候选图数: String(results.length),
    还原度与风格评价: results.length
      ? `像实物 ${realOk}、不像 ${realBad}；风格对 ${styleOk}、不对 ${styleBad}${issues.length ? `；问题：${issues.join('、')}` : ''}${notes.length ? `；原话：${notes.join(' / ')}` : ''}`
      : '',
    修改与补图次数: `修改 ${count(ev, 'revise')}，补齐 ${count(ev, 'retry')}，加照片 ${Math.max(0, count(ev, 'upload') - 1)}`,
    '耗时（分钟）': String(minutes),
    人工帮助: '',
    '累计成本（美元）': work.costUSD.toFixed(4),
    导出: `${results.filter((r) => r.exports.length).length} 张（两项通过 ${results.filter(passed).length} 张）`,
    实际发布: `${results.filter((r) => r.published).length} 张`,
    布景复用: `${scene}${saves ? `；存了 ${saves} 次布景` : ''}`,
    建议: '',
  };
}

// 删除作品时只留一条带花费的删除记录，汇总成一行，累计成本不漏算
export function deletedRow(anonId: string, events: readonly TrialEvent[]): TrialRow | null {
  const deleted = events.filter((e) => e.type === 'delete_work');
  if (!deleted.length) return null;
  const cost = deleted.reduce((sum, e) => sum + (typeof e.data?.costUSD === 'number' ? e.data.costUSD : 0), 0);
  const row = Object.fromEntries(TRIAL_COLUMNS.map((c) => [c, ''])) as TrialRow;
  return { ...row, 匿名编号: anonId, 作品序号: `已删除 ${deleted.length} 件`, '累计成本（美元）': cost.toFixed(4) };
}

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

// CSV 带 BOM，Excel 直接打开不乱码
export const toCsv = (rows: readonly TrialRow[]) =>
  '﻿' + [TRIAL_COLUMNS.join(','), ...rows.map((r) => TRIAL_COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n');
