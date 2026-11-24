import { describe, expect, it } from 'vitest';
import { backdrop, backdropPromptedWork, backdropWork, BUILTIN, pickBuiltin, pickOwn, promptedWork, readyWork, result, stateOf } from '@/test/fixtures';
import { backdropPromptStatus, sceneApprovalStatus, scenePromptStatus } from './approval';
import { refOfBackdrop, refOfBuiltin } from './backdrops';
import { backdropBasisOf, sceneBasisOf } from './snapshot';
import type { Asset, AskItem, SceneApproval, Work } from './types';
import {
  acceptSuggestion,
  addCost,
  addStoryNote,
  advanceStep,
  approveBackdrop,
  approveScene,
  cancelRevision,
  closeAsk,
  chooseBackdrop,
  clearBackdrop,
  confirmSummary,
  dismissSuggestion,
  draftSummary,
  editPrompt,
  editSummary,
  keepStyleForSummary,
  markPromptChecked,
  markUnknown,
  newWork,
  openAsk,
  queueHandoff,
  renameWork,
  reviseFrom,
  revertPrompt,
  setBackdropMode,
  setInfo,
  setRatio,
  setStyle,
  startBackdropRound,
  startSceneRound,
  styleLagsSummary,
  suggestInfo,
  summaryEdits,
} from './work';

const fresh = () => newWork({ imageModel: 'img-a', chatModel: 'chat-a' });

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
    const work = backdropWork();
    expect(work.story.summaryState).toBe('confirmed');
    expect(draftSummary(work, { express: '新', feel: '', avoid: '' }).story.summaryState).toBe('draft');
  });

  it('用户自己改不改变确认状态；没有总结时不能确认', () => {
    const work = backdropWork();
    expect(editSummary(work, { express: '改了一句', feel: '安静', avoid: '太花' }).story.summaryState).toBe('confirmed');
    const empty = fresh();
    expect(confirmSummary(empty).story.summaryState).toBe('none');
    expect(editSummary(empty, { express: '我自己写', feel: '', avoid: '' }).story.summaryState).toBe('draft');
  });

  it('和现在一样的总结不重复起草，已确认的不会被打回草稿（BC-007）', () => {
    const work = backdropWork();
    expect(draftSummary(work, { express: ' 雨后青苔 ', feel: '安静', avoid: '太花' })).toBe(work);
    expect(work.story.summaryState).toBe('confirmed');
  });

  it('记下小间起草的原文，能对出用户确认前改掉了哪几项（BC-003）', () => {
    const drafted = draftSummary(fresh(), { express: '像退潮后的海边早晨', feel: '清透', avoid: '' });
    expect(summaryEdits(drafted.story)).toEqual([]);
    const edited = confirmSummary(editSummary(drafted, { express: '清透、安静，克制的海岸感', feel: '清透', avoid: '' }));
    expect(summaryEdits(edited.story)).toEqual([{ part: 'express', drafted: '像退潮后的海边早晨', now: '清透、安静，克制的海岸感' }]);
    // 用户自己从头写的总结没有小间的原文，不报改动
    expect(summaryEdits(editSummary(fresh(), { express: '我自己写', feel: '', avoid: '' }).story)).toEqual([]);
  });

  it('同样内容的共创记录只记一次（BC-007）', () => {
    const w = addStoryNote(fresh(), 'inspiration', '午后窗框投影');
    expect(addStoryNote(w, 'inspiration', ' 午后窗框投影 ')).toBe(w);
    expect(addStoryNote(w, 'theme', '建筑线条').story.notes.map((n) => n.text)).toEqual(['午后窗框投影', '建筑线条']);
  });
});

describe('新建作品：按入口定流程（PRD 5.2）', () => {
  it('首页开始是流程一，背景还没选做法；套用模板是流程二，背景一进来就选好', () => {
    expect(fresh()).toMatchObject({ flow: 'home', backdropMode: null, backdropId: null, backdropRound: 0, round: 0 });
    expect(newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId: BUILTIN })).toMatchObject({ flow: 'template', backdropMode: 'library', backdropId: BUILTIN });
  });
});

describe('背景的做法与选定（技术写法 13.4）', () => {
  it('换做法清掉已选的背景；流程一里选模板仍是流程一', () => {
    const picked = pickBuiltin(fresh(), BUILTIN);
    expect(picked).toMatchObject({ flow: 'home', backdropMode: 'library', backdropId: BUILTIN });
    expect(setBackdropMode(picked, 'generate')).toMatchObject({ flow: 'home', backdropMode: 'generate', backdropId: null });
    expect(setBackdropMode(picked, 'library')).toBe(picked);
  });

  it('选这件作品的候选、重新设计背景', () => {
    const w = setBackdropMode(fresh(), 'generate');
    const chosen = pickOwn(w, 'bd_1');
    expect(chosen).toMatchObject({ backdropId: 'bd_1', backdropMode: 'generate' });
    expect(pickOwn(chosen, 'bd_1')).toBe(chosen);
    expect(clearBackdrop(chosen)).toMatchObject({ backdropId: null, backdropMode: 'generate' });
    expect(clearBackdrop(w)).toBe(w);
  });

  it('做法跟着背景图的来源走，不看从哪个入口选（评审第 1 条）', () => {
    const w = setBackdropMode(fresh(), 'generate');
    const own = refOfBackdrop(backdrop(w.id, 1, 0, { savedAt: 1 }));
    // 自家的，沉淀过也算：在「用模板库里的」下点它，切回自己生成
    expect(chooseBackdrop(setBackdropMode(w, 'library'), own)).toMatchObject({ backdropId: own.id, backdropMode: 'generate', flow: 'home' });
    // 内置模板、别的作品沉淀的：用模板库里的
    expect(chooseBackdrop(w, refOfBuiltin(BUILTIN)!)).toMatchObject({ backdropId: BUILTIN, backdropMode: 'library', flow: 'home' });
    const other = refOfBackdrop(backdrop('work_other', 1, 0, { savedAt: 1 }));
    expect(chooseBackdrop(w, other)).toMatchObject({ backdropId: other.id, backdropMode: 'library' });
    // 已经是这张、做法也对：原样返回；旧数据里「用模板库里的＋自家背景」再点一次会纠正
    const picked = chooseBackdrop(w, own);
    expect(chooseBackdrop(picked, own)).toBe(picked);
    expect(chooseBackdrop({ ...picked, backdropMode: 'library' }, own).backdropMode).toBe('generate');
    // 兜底：自己生成只在流程一
    expect(chooseBackdrop({ ...w, flow: 'template', backdropMode: 'library' }, own).flow).toBe('home');
  });
});

describe('提示词：背景、合成各一段', () => {
  it('撤销手改恢复小间写的那一版', () => {
    const { work, assets } = promptedWork();
    const back = revertPrompt(editPrompt(work, 'scene', '手改的', sceneBasisOf(work, assets)), 'scene');
    expect(back.prompt).toMatchObject({ text: work.prompt!.text, edited: false, sync: 'ok', author: 'agent' });
    const b = backdropPromptedWork();
    const bBack = revertPrompt(editPrompt(b, 'backdrop', '手改的背景', backdropBasisOf(b)), 'backdrop');
    expect(bBack.backdropPrompt).toMatchObject({ text: b.backdropPrompt!.text, edited: false });
    expect(bBack.prompt).toBeNull();
  });

  it('依据变了标过期；用户核对后确认仍然适用，依据更新为当前（AC-07.2a、AC-11.6）', () => {
    const { work, assets } = promptedWork();
    const changed = setStyle(work, 'placement', '悬挂', 'user');
    expect(scenePromptStatus(changed, sceneBasisOf(changed, assets))).toEqual({ kind: 'stale', changed: ['摆放'] });
    const checked = markPromptChecked(changed, 'scene', sceneBasisOf(changed, assets));
    expect(scenePromptStatus(checked, sceneBasisOf(checked, assets))).toEqual({ kind: 'ok' });
    const b = setStyle(backdropPromptedWork(), 'background', '亚麻布', 'user');
    expect(backdropPromptStatus(b)).toEqual({ kind: 'stale', changed: ['背景'] });
    expect(backdropPromptStatus(markPromptChecked(b, 'backdrop', backdropBasisOf(b)))).toEqual({ kind: 'ok' });
  });
});

describe('批准与生成', () => {
  it('有阻塞时不能批准，并返回原因', () => {
    const { work, assets } = readyWork();
    const r = approveScene(stateOf(work, assets));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.map((b) => b.text)).toEqual(['合成提示词还没写']);
  });

  it('合成批准记录快照和版本号；一版批准只能生成一轮', () => {
    const { work, assets } = promptedWork();
    const r1 = approveScene(stateOf(work, assets));
    if (!r1.ok) throw new Error('应当可以批准');
    expect(r1.approval).toMatchObject({ kind: 'scene', version: 1, usedRound: null, parentResultId: null });
    expect(r1.work.approvalId).toBe(r1.approval.id);
    const s1 = startSceneRound(stateOf(r1.work, assets, { approval: r1.approval }), r1.approval);
    if (!s1.ok) throw new Error('应当可以生成');
    expect([s1.round, s1.approval.usedRound]).toEqual([1, 1]);
    expect(startSceneRound(stateOf(s1.work, assets, { approval: s1.approval }), s1.approval).ok).toBe(false);
    const r2 = approveScene(stateOf(s1.work, assets, { approval: s1.approval }));
    if (!r2.ok) throw new Error('应当可以再次批准');
    expect(r2.approval.version).toBe(2);
  });

  it('背景批准和合成批准各自编号', () => {
    const w = backdropPromptedWork();
    const b = approveBackdrop(stateOf(w));
    if (!b.ok) throw new Error('应当可以批准背景');
    expect(b.approval.version).toBe(1);
    expect(b.work).toMatchObject({ backdropApprovalCount: 1, approvalCount: 0 });
    const s = startBackdropRound(stateOf(b.work, [], { backdropApproval: b.approval }), b.approval);
    expect(s.ok && s.work.backdropRound).toBe(1);
    expect(s.ok && s.work.round).toBe(0);
  });
});

// 生成一轮后，取第 1 轮的结果，便于测「从这一版修改」
function generatedOnce(): { work: Work; assets: Asset[]; approval: SceneApproval } {
  const { work, assets } = promptedWork();
  const a = approveOk(work, assets);
  const s = startSceneRound(stateOf(a.work, assets, { approval: a.approval }), a.approval);
  if (!s.ok) throw new Error('应当可以生成');
  return { work: s.work, assets, approval: s.approval };
}

function approveOk(work: Work, assets: Asset[], approval: SceneApproval | null = null) {
  const r = approveScene(stateOf(work, assets, { approval }));
  if (!r.ok) throw new Error(`应当可以批准：${r.blockers.map((b) => b.text).join('；')}`);
  return r;
}

describe('从指定版本修改（AC-09.4）', () => {
  it('恢复那一版的摆放、背景图、比例、生图模型和提示词；三视图、商品信息和总结保持现在的', () => {
    const { work, assets, approval } = generatedOnce();
    const r = { ...result(work.id, 1, 1), approvalId: approval.id, issues: ['构图'] };
    let w = setStyle(work, 'composition', '主体放大，突出细节', 'user');
    w = setRatio(pickBuiltin(w, 'builtin:rose@1'), '3:4');
    w = setInfo(w, 'price', '128 元');
    const revised = reviseFrom(w, r, approval, []);
    expect(revised.style.composition.value).toBe(approval.snapshot.style.composition);
    expect([revised.ratio, revised.backdropId, revised.backdropMode]).toEqual([approval.snapshot.ratio, BUILTIN, 'library']);
    expect(revised.prompt?.text).toBe(approval.snapshot.prompt);
    expect(revised.info.price.value).toBe('128 元');
    expect(revised.revision).toMatchObject({ fromResultId: r.id, reasons: ['构图'] });
    // 恢复后和那一版一模一样：旧批准重新有效，提示词有效
    expect(sceneApprovalStatus(stateOf(revised, assets, { approval })).kind).toBe('valid');
    expect(scenePromptStatus(revised, sceneBasisOf(revised, assets)).kind).toBe('ok');
  });

  it('恢复的背景图定做法（评审第 5 条）：现在用模板、恢复自家的 → 自己生成；现在自己生成、恢复别的作品沉淀的 → 用模板库里的', () => {
    const { work, approval } = generatedOnce();
    const own = backdrop(work.id, 1, 0, { savedAt: 1 });
    const usedOwn: SceneApproval = { ...approval, snapshot: { ...approval.snapshot, backdropId: own.id } };
    const fromOwn = reviseFrom(work, result(work.id, 1, 0), usedOwn, [own]);
    expect(fromOwn).toMatchObject({ backdropId: own.id, backdropMode: 'generate', flow: 'home' });
    expect(cancelRevision(fromOwn)).toMatchObject({ backdropId: BUILTIN, backdropMode: 'library' });

    const generating = chooseBackdrop(setBackdropMode(work, 'generate'), refOfBackdrop(own));
    const usedOther: SceneApproval = { ...approval, snapshot: { ...approval.snapshot, backdropId: 'bd_other' } };
    const fromOther = reviseFrom(generating, result(work.id, 1, 1), usedOther, [own]);
    expect(fromOther).toMatchObject({ backdropId: 'bd_other', backdropMode: 'library' });
    expect(cancelRevision(fromOther)).toMatchObject({ backdropId: own.id, backdropMode: 'generate' });
    // 恢复内置模板：用模板库里的
    expect(reviseFrom(generating, result(work.id, 1, 0), approval, [own])).toMatchObject({ backdropId: BUILTIN, backdropMode: 'library' });
  });

  it('那一版之后改过商品信息：恢复的提示词标为过期', () => {
    const { work, assets, approval } = generatedOnce();
    const revised = reviseFrom(setInfo(work, 'material', '纯银'), result(work.id, 1, 0), approval, []);
    expect(scenePromptStatus(revised, sceneBasisOf(revised, assets))).toEqual({ kind: 'stale', changed: ['商品信息'] });
  });

  it('取消修改恢复修改前的方案（含背景图）；连着从两张修改，取消回到最初', () => {
    const { work, approval } = generatedOnce();
    const before = setStyle(setRatio(pickBuiltin(work, 'builtin:stone@1'), '9:16'), 'placement', '悬挂', 'user');
    const once = reviseFrom(before, result(work.id, 1, 0), approval, []);
    const twice = reviseFrom(setRatio(once, '3:4'), result(work.id, 1, 1), approval, []);
    const back = cancelRevision(twice);
    expect([back.ratio, back.backdropId]).toEqual(['9:16', 'builtin:stone@1']);
    expect(back.style.placement).toEqual(before.style.placement);
    expect(back.prompt).toEqual(before.prompt);
    expect(back.revision).toBeUndefined();
    expect(cancelRevision(back)).toBe(back);
  });

  it('批准时记下父结果；开始生成后修改记录清掉', () => {
    const { work, assets, approval } = generatedOnce();
    const r = result(work.id, 1, 0);
    const changed = setStyle(reviseFrom(work, r, approval, []), 'bannedScene', '花', 'user');
    const revised = markPromptChecked(changed, 'scene', sceneBasisOf(changed, assets));
    const a = approveOk(revised, assets, approval);
    expect(a.approval.parentResultId).toBe(r.id);
    const s = startSceneRound(stateOf(a.work, assets, { approval: a.approval }), a.approval);
    if (!s.ok) throw new Error('应当可以生成');
    expect(s.work.revision).toBeUndefined();
    expect(approveOk(s.work, assets, s.approval).approval.parentResultId).toBeNull();
  });
});

describe('杂项', () => {
  it('名字清空时保留原名；花费累加不丢精度', () => {
    const w = renameWork(fresh(), '雨后青苔');
    expect(renameWork(w, '   ').name).toBe('雨后青苔');
    expect(addCost(addCost(w, 0.1), 0.2).costUSD).toBe(0.3);
  });
});

describe('作品名称：用户和小间都直接改（技术写法 14.3）', () => {
  it('改名去掉首尾空格；和现名相同或为空时不改', () => {
    const w = renameWork(fresh(), ' 银杏叶耳坠 ');
    expect(w.name).toBe('银杏叶耳坠');
    expect(renameWork(w, '银杏叶耳坠')).toBe(w);
    expect(renameWork(w, '  ')).toBe(w);
  });
});

describe('小间推进下一步（技术写法 14.7）', () => {
  it('记下交接快照，去掉这一步还在排队的交接，别的步骤照旧排着', () => {
    const w = queueHandoff(queueHandoff(fresh(), 'product'), 'info');
    const facts = { 流程: { text: '首页开始' } };
    const a = advanceStep(w, 'product', facts, 123);
    expect(a.lastHandoff).toEqual({ step: 'product', at: 123, facts });
    expect(a.pendingHandoffs).toEqual(['info']);
  });
});

describe('问过再代点的请求（技术写法 14.4）', () => {
  const item: AskItem = { action: { type: 'confirm_summary' }, text: '确认共创总结', target: null, mark: 'x' };

  it('同一时间只有一条在等回复：再问一条，旧的作废', () => {
    const a = openAsk(fresh(), 'call_1', [item], 1);
    expect(a.asks?.call_1).toMatchObject({ id: 'call_1', at: 1, state: 'waiting' });
    const b = openAsk(a, 'call_2', [item], 2);
    expect(b.asks?.call_1).toMatchObject({ state: 'replaced', closedAt: 2 });
    expect(b.asks?.call_2?.state).toBe('waiting');
  });

  it('结束一条请求：记下原话和代点了哪几样；已经结束的不再改', () => {
    const a = openAsk(fresh(), 'call_1', [item, item], 1);
    const done = closeAsk(a, 'call_1', { state: 'done', quote: '同意', done: [0] }, 5);
    expect(done.asks?.call_1).toMatchObject({ state: 'done', quote: '同意', done: [0], closedAt: 5 });
    expect(closeAsk(done, 'call_1', { state: 'expired', reason: '变了' })).toBe(done);
    expect(closeAsk(done, 'nope', { state: 'expired' })).toBe(done);
  });
});

describe('改故事后风格推荐可能要跟着变（AC-04.6）', () => {
  const sum = { express: '雨后的安静', feel: '想凑近看', avoid: '太花' };
  it('小间按旧总结推荐过风格，总结改了才提示；用户说不用改后不再提示', () => {
    let w = confirmSummary(draftSummary(fresh(), sum));
    expect(styleLagsSummary(w)).toBe(false);
    w = setStyle(w, 'light', '清冷晨光', 'recommend', '雨后感');
    expect(w.styleSummary).toEqual(sum);
    expect(styleLagsSummary(w)).toBe(false);
    w = editSummary(w, { ...sum, feel: '温暖、像礼物' });
    expect(styleLagsSummary(w)).toBe(true);
    expect(styleLagsSummary(keepStyleForSummary(w))).toBe(false);
    // 小间按新总结再推荐一次，也不再提示
    expect(styleLagsSummary(setStyle(w, 'tone', '暖调', 'recommend'))).toBe(false);
  });

  it('推荐摆放或构图不算重新检查过背景风格，提示还在（评审第 8 条）', () => {
    let w = setStyle(confirmSummary(draftSummary(fresh(), sum)), 'light', '清冷晨光', 'recommend');
    w = editSummary(w, { ...sum, feel: '温暖、像礼物' });
    for (const k of ['placement', 'composition', 'bannedScene'] as const) {
      const after = setStyle(w, k, '平铺', 'recommend');
      expect(after.styleSummary).toEqual(sum);
      expect(styleLagsSummary(after)).toBe(true);
    }
    // 背景五项任一项按新总结推荐过：不再提示
    expect(styleLagsSummary(setStyle(w, 'bannedBackdrop', '花', 'recommend'))).toBe(false);
  });

  it('风格不是小间推荐的（用户自己选）时不提示', () => {
    let w = confirmSummary(draftSummary(fresh(), sum));
    w = setStyle(w, 'light', '清冷晨光', 'user');
    w = editSummary(w, { ...sum, express: '别的' });
    expect(styleLagsSummary(w)).toBe(false);
  });
});
