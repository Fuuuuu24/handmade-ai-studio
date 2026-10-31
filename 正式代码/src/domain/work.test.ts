import { describe, expect, it } from 'vitest';
import { builtinScene } from '@/config/scenes';
import { current, currentBasis, promptedWork, readyWork } from '@/test/fixtures';
import {
  acceptSuggestion,
  addCost,
  applyScene,
  approve,
  confirmSummary,
  dismissSuggestion,
  draftSummary,
  editPrompt,
  editSummary,
  markUnknown,
  newWork,
  renameWork,
  revertPrompt,
  setInfo,
  setRoute,
  setStyle,
  startRound,
  suggestInfo,
} from './work';

const fresh = () => newWork({ imageModel: 'img-a', chatModel: 'chat-a', route: 'B' });

describe('商品信息：小间只能写建议', () => {
  it('建议不改已确认的值；接受后才成为值', () => {
    let w = setInfo(fresh(), 'material', '黄铜');
    w = suggestInfo(w, 'material', '黄铜镀金', '照片里看着有镀层');
    expect(w.info.material.value).toBe('黄铜');
    expect(w.info.material.suggestion).toMatchObject({ value: '黄铜镀金', note: '照片里看着有镀层' });
    w = acceptSuggestion(w, 'material');
    expect(w.info.material).toEqual({ value: '黄铜镀金', unknown: false });
  });

  it('和已确认的值相同的建议不记录；放弃建议保留原值', () => {
    const w = setInfo(fresh(), 'category', '耳饰');
    expect(suggestInfo(w, 'category', '耳饰')).toBe(w);
    const s = suggestInfo(w, 'category', '耳夹');
    expect(dismissSuggestion(s, 'category').info.category).toEqual({ value: '耳饰', unknown: false });
  });

  it('用户直接填写会丢掉待确认建议；标未知会清空值', () => {
    let w = suggestInfo(fresh(), 'size', '约 3cm');
    w = setInfo(w, 'size', '长 4.5cm');
    expect(w.info.size).toEqual({ value: '长 4.5cm', unknown: false });
    expect(markUnknown(w, 'size', true).info.size).toEqual({ value: '', unknown: true });
  });
});

describe('共创总结：小间只能写草稿', () => {
  it('起草总是草稿，即使原来已确认', () => {
    const { work } = readyWork();
    expect(work.story.summaryState).toBe('confirmed');
    expect(draftSummary(work, { express: '新', feel: '', avoid: '' }).story.summaryState).toBe('draft');
  });

  it('用户自己改不改变确认状态；没有总结时不能确认', () => {
    const { work } = readyWork();
    expect(editSummary(work, { express: '改了一句', feel: '安静', avoid: '太花' }).story.summaryState).toBe('confirmed');
    const empty = fresh();
    expect(confirmSummary(empty).story.summaryState).toBe('none');
    expect(editSummary(empty, { express: '我自己写', feel: '', avoid: '' }).story.summaryState).toBe('draft');
  });
});

describe('风格与布景', () => {
  it('套用布景覆盖布景管的项，保留「表达」，来源标为布景', () => {
    let w = setStyle(fresh(), 'expression', '安静的绿', 'said');
    const scene = builtinScene('tpl-cream')!;
    w = applyScene(w, scene.id, scene.params);
    expect(w.sceneId).toBe('tpl-cream');
    expect(w.style.light).toEqual({ value: '暖调午后光', source: 'scene' });
    expect(w.style.expression).toEqual({ value: '安静的绿', source: 'said', reason: undefined });
  });

  it('换资产路线要重新确认资产', () => {
    const { work } = readyWork();
    expect(setRoute(work, 'A').assetsConfirmed).toBe(false);
    expect(setRoute(work, 'B')).toBe(work);
  });
});

describe('提示词', () => {
  it('撤销手改恢复小间写的那一版', () => {
    const { work, assets } = promptedWork();
    const edited = editPrompt(work, '手改的', currentBasis(work, assets));
    const back = revertPrompt(edited);
    expect(back.prompt).toMatchObject({ text: work.prompt!.text, edited: false, sync: 'ok', author: 'agent' });
  });
});

describe('批准与生成', () => {
  it('有阻塞时不能批准，并返回原因', () => {
    const { work, assets } = readyWork();
    const r = approve(work, assets, current(work, assets), false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.map((b) => b.text)).toEqual(['提示词还没写']);
  });

  it('批准记录快照和版本号；一版批准只能生成一轮', () => {
    const { work, assets } = promptedWork();
    const r1 = approve(work, assets, current(work, assets), false);
    if (!r1.ok) throw new Error('应当可以批准');
    expect(r1.approval).toMatchObject({ version: 1, usedRound: null, snapshot: current(work, assets) });
    expect(r1.work.approvalId).toBe(r1.approval.id);

    const s1 = startRound(r1.work, r1.approval, current(r1.work, assets), false);
    if (!s1.ok) throw new Error('应当可以生成');
    expect(s1.round).toBe(1);
    expect(s1.approval.usedRound).toBe(1);
    expect(startRound(s1.work, s1.approval, current(s1.work, assets), false).ok).toBe(false);

    const r2 = approve(s1.work, assets, current(s1.work, assets), false);
    if (!r2.ok) throw new Error('应当可以再次批准');
    expect(r2.approval.version).toBe(2);
    const s2 = startRound(r2.work, r2.approval, current(r2.work, assets), false);
    expect(s2.ok && s2.round).toBe(2);
  });
});

describe('杂项', () => {
  it('名字清空时保留原名；花费累加不丢精度', () => {
    const w = renameWork(fresh(), '雨后青苔');
    expect(renameWork(w, '   ').name).toBe('雨后青苔');
    expect(addCost(addCost(w, 0.1), 0.2).costUSD).toBe(0.3);
  });
});
