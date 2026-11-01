import { describe, expect, it } from 'vitest';
import { current, promptedWork, result, task, upload } from '@/test/fixtures';
import { currentStep, stepStates, workStatusKey, type StatusInput } from './status';
import type { Approval } from './types';
import { approve, confirmAssets, confirmSummary, draftSummary, newWork, setRatio, startRound } from './work';

const input = (p: Partial<StatusInput> & Pick<StatusInput, 'work'>): StatusInput => {
  const assets = p.assets ?? [];
  return { assets, tasks: [], results: [], approval: null, current: current(p.work, assets), ...p };
};

describe('workStatusKey（PRD 5.3）', () => {
  it('从草稿走到可生成', () => {
    let work = newWork({ imageModel: 'img-a', chatModel: 'chat-a', route: 'B' });
    expect(workStatusKey(input({ work }))).toBe('draft');
    const assets = [upload(work.id)];
    expect(workStatusKey(input({ work, assets }))).toBe('assets');
    work = confirmAssets(work);
    expect(workStatusKey(input({ work, assets }))).toBe('story');
    work = draftSummary(work, { express: 'a', feel: 'b', avoid: 'c' });
    expect(workStatusKey(input({ work, assets }))).toBe('summary');
    work = confirmSummary(work);
    expect(workStatusKey(input({ work, assets }))).toBe('plan');
  });

  it('批准后可生成；生成中；部分出图待验收；两项满意为已完成；两张都失败为生成失败', () => {
    const { work, assets } = promptedWork();
    const r = approve(work, assets, current(work, assets), false);
    if (!r.ok) throw new Error('应当可以批准');
    expect(workStatusKey(input({ work: r.work, assets, approval: r.approval }))).toBe('ready');

    const s = startRound(r.work, r.approval, current(r.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    const base = { work: s.work, assets, approval: s.approval as Approval };
    expect(workStatusKey(input({ ...base, tasks: [task(work.id, 1, 0, 'running'), task(work.id, 1, 1, 'queued')] }))).toBe(
      'generating',
    );
    const t = [task(work.id, 1, 0, 'succeeded'), task(work.id, 1, 1, 'failed')];
    expect(workStatusKey(input({ ...base, tasks: t, results: [result(work.id, 1, 0)] }))).toBe('review');
    expect(
      workStatusKey(input({ ...base, tasks: t, results: [result(work.id, 1, 0, { real: 'ok', style: 'ok' })] })),
    ).toBe('done');
    expect(
      workStatusKey(input({ ...base, tasks: [task(work.id, 1, 0, 'failed'), task(work.id, 1, 1, 'failed')] })),
    ).toBe('failed');
  });

  it('完成后再改方案，状态回到方案待确认', () => {
    const { work, assets } = promptedWork();
    const r = approve(work, assets, current(work, assets), false);
    if (!r.ok) throw new Error('应当可以批准');
    const s = startRound(r.work, r.approval, current(r.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    const changed = setRatio(s.work, '3:4');
    const res = [result(work.id, 1, 0, { real: 'ok', style: 'ok' })];
    expect(workStatusKey(input({ work: changed, assets, approval: s.approval, results: res }))).toBe('plan');
  });
});

describe('stepStates', () => {
  it('批准后改动：方案标失效，旧结果标「上一版」', () => {
    const { work, assets } = promptedWork();
    const r = approve(work, assets, current(work, assets), false);
    if (!r.ok) throw new Error('应当可以批准');
    const s = startRound(r.work, r.approval, current(r.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    const res = [result(work.id, 1, 0, { real: 'ok', style: 'bad' })];
    const before = stepStates(input({ work: s.work, assets, approval: s.approval, results: res }));
    expect(before).toEqual({ asset: 'done', info: 'done', story: 'done', plan: 'done', output: 'todo' });
    expect(currentStep(before)).toBe('output');

    const changed = setRatio(s.work, '9:16');
    const after = stepStates(input({ work: changed, assets, approval: s.approval, results: res }));
    expect(after.plan).toBe('stale');
    expect(after.output).toBe('stale');
    expect(currentStep(after)).toBe('plan');
  });
});
