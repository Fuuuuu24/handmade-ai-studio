import { describe, expect, it } from 'vitest';
import { builtinScene } from '@/config/scenes';
import { current, currentBasis, promptedWork, readyWork, result } from '@/test/fixtures';
import { approvalStatus, promptStatus } from './approval';
import type { Approval, Asset, Work } from './types';
import {
  acceptSuggestion,
  addCost,
  applyScene,
  approve,
  cancelRevision,
  confirmSummary,
  dismissSuggestion,
  draftSummary,
  editPrompt,
  editSummary,
  markPromptChecked,
  markUnknown,
  newWork,
  renameWork,
  reviseFrom,
  revertPrompt,
  setInfo,
  setRatio,
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

describe('提示词过期后由用户确认（AC-07.2a、AC-11.6）', () => {
  it('依据变了标过期；用户核对后确认仍然适用，依据更新为当前', () => {
    const { work, assets } = promptedWork();
    const changed = setStyle(work, 'light', '暖调午后光', 'user');
    expect(promptStatus(changed, currentBasis(changed, assets))).toEqual({ kind: 'stale', changed: ['光线'] });
    const checked = markPromptChecked(changed, currentBasis(changed, assets));
    expect(promptStatus(checked, currentBasis(checked, assets))).toEqual({ kind: 'ok' });
  });
});

// 生成一轮后，取第 1 轮第 2 张结果，便于测「从这一版修改」
function generatedOnce(): { work: Work; assets: Asset[]; approval: Approval } {
  const { work, assets } = promptedWork();
  const a = approveOk(work, assets);
  const s = startRound(a.work, a.approval, current(a.work, assets), false);
  if (!s.ok) throw new Error('应当可以生成');
  return { work: s.work, assets, approval: s.approval };
}

function approveOk(work: Work, assets: Asset[]) {
  const r = approve(work, assets, current(work, assets), false);
  if (!r.ok) throw new Error(`应当可以批准：${r.blockers.map((b) => b.text).join('；')}`);
  return r;
}

describe('从指定版本修改（AC-09.4）', () => {
  it('恢复那一版的风格、布景、比例、生图模型和提示词；商品信息、共创总结和照片保持现在的', () => {
    const { work, assets, approval } = generatedOnce();
    const r = { ...result(work.id, 1, 1), approvalId: approval.id, issues: ['光线'] };
    let w = setStyle(work, 'light', '窗边侧光', 'user');
    w = setRatio(w, '3:4');
    w = setInfo(w, 'price', '128 元');
    const revised = reviseFrom(w, r, approval);
    expect(revised.style.light.value).toBe(approval.snapshot.style.light);
    expect(revised.ratio).toBe(approval.snapshot.ratio);
    expect(revised.prompt?.text).toBe(approval.snapshot.prompt);
    expect(revised.info.price.value).toBe('128 元');
    expect(revised.revision).toMatchObject({ fromResultId: r.id, reasons: ['光线'] });
    // 恢复后和那一版一模一样：旧批准重新有效，提示词有效
    expect(approvalStatus(approval, current(revised, assets)).kind).toBe('valid');
    expect(promptStatus(revised, currentBasis(revised, assets)).kind).toBe('ok');
  });

  it('那一版之后改过商品信息：恢复的提示词标为过期，需要重写或确认', () => {
    const { work, assets, approval } = generatedOnce();
    const w = setInfo(work, 'material', '纯银');
    const revised = reviseFrom(w, result(work.id, 1, 0), approval);
    expect(revised.info.material.value).toBe('纯银');
    expect(promptStatus(revised, currentBasis(revised, assets))).toEqual({ kind: 'stale', changed: ['商品信息'] });
  });

  it('取消修改恢复修改前的方案；连着从两张修改，取消回到最初', () => {
    const { work, approval } = generatedOnce();
    const before = setStyle(setRatio(work, '9:16'), 'tone', '深墨对比', 'user');
    const once = reviseFrom(before, result(work.id, 1, 0), approval);
    const twice = reviseFrom(setRatio(once, '3:4'), result(work.id, 1, 1), approval);
    expect(twice.revision?.fromResultId).not.toBe(once.revision?.fromResultId);
    const back = cancelRevision(twice);
    expect(back.ratio).toBe('9:16');
    expect(back.style.tone).toEqual(before.style.tone);
    expect(back.prompt).toEqual(before.prompt);
    expect(back.revision).toBeUndefined();
    expect(cancelRevision(back)).toBe(back);
  });

  it('批准时记下父结果；开始生成后修改记录清掉', () => {
    const { work, assets, approval } = generatedOnce();
    const r = result(work.id, 1, 0);
    const changed = setStyle(reviseFrom(work, r, approval), 'props', '一段丝带', 'user');
    const revised = markPromptChecked(changed, currentBasis(changed, assets));
    const a = approveOk(revised, assets);
    expect(a.approval.parentResultId).toBe(r.id);
    const s = startRound(a.work, a.approval, current(a.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    expect(s.work.revision).toBeUndefined();
    expect(approveOk(s.work, assets).approval.parentResultId).toBeNull();
  });
});

describe('杂项', () => {
  it('名字清空时保留原名；花费累加不丢精度', () => {
    const w = renameWork(fresh(), '雨后青苔');
    expect(renameWork(w, '   ').name).toBe('雨后青苔');
    expect(addCost(addCost(w, 0.1), 0.2).costUSD).toBe(0.3);
  });
});
