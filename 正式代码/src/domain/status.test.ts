import { describe, expect, it } from 'vitest';
import { backdrop, backdropPromptedWork, BUILTIN, pickBuiltin, product, promptedWork, result, stateOf, task, upload, view } from '@/test/fixtures';
import { refOfBackdrop } from './backdrops';
import { currentStep, stepStates, workStatusKey } from './status';
import type { Asset, SceneApproval, Work, WorkState } from './types';
import {
  acceptSuggestion,
  approveScene,
  chooseBackdrop,
  confirmSummary,
  draftSummary,
  newWork,
  setBackdropMode,
  setInfo,
  setRatio,
  setStyle,
  startSceneRound,
  suggestInfo,
  writePrompt,
} from './work';
import { sceneBasisOf } from './snapshot';

const fresh = (backdropId?: string) => newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId });
const withInfo = (w: Work) => setInfo(setInfo(setInfo(w, 'category', '耳饰'), 'material', '黄铜'), 'size', '3cm');
const withScene = (w: Work, assets: readonly Asset[]) => {
  const s = setStyle(setStyle(w, 'placement', '平铺', 'user'), 'composition', '主体居中，留白多', 'user');
  return writePrompt(s, 'scene', '第 1 张是背景……', sceneBasisOf(s, assets));
};

function approvedAndStarted(): { s: WorkState; approval: SceneApproval } {
  const { work, assets } = promptedWork();
  const a = approveScene(stateOf(work, assets));
  if (!a.ok) throw new Error('应当可以批准');
  const st = startSceneRound(stateOf(a.work, assets, { approval: a.approval }), a.approval);
  if (!st.ok) throw new Error('应当可以生成');
  return { s: stateOf(st.work, assets, { approval: st.approval }), approval: st.approval };
}

describe('作品状态（PRD 5.3）：流程一，用模板库里的背景', () => {
  it('草稿 → 资产待确认 → 信息待处理 → 背景待选择方式 → 背景待选定 → 方案待确认 → 可生成', () => {
    let work = fresh();
    expect(workStatusKey(stateOf(work))).toBe('draft');
    const photos = (['front', 'side', 'back'] as const).map((k) => upload(work.id, k));
    expect(workStatusKey(stateOf(work, photos))).toBe('assets');
    const views = photos.map((p) => view(p));
    expect(workStatusKey(stateOf(work, [...photos, ...views]))).toBe('info');
    work = withInfo(work);
    const assets = [...photos, ...views];
    expect(workStatusKey(stateOf(work, assets))).toBe('backdropMode');
    work = setBackdropMode(work, 'library');
    expect(workStatusKey(stateOf(work, assets))).toBe('backdropPick');
    work = pickBuiltin(work, BUILTIN);
    expect(workStatusKey(stateOf(work, assets))).toBe('plan');
    work = withScene(work, assets);
    const a = approveScene(stateOf(work, assets));
    if (!a.ok) throw new Error('应当可以批准');
    expect(workStatusKey(stateOf(a.work, assets, { approval: a.approval }))).toBe('ready');
  });

  it('信息里还有核心建议没处理：停在信息待处理（BC-002）', () => {
    const { work, assets } = promptedWork();
    const w = suggestInfo(work, 'keep', '两个圈不能变形');
    expect(workStatusKey(stateOf(w, assets))).toBe('info');
    expect(workStatusKey(stateOf(acceptSuggestion(w, 'keep'), assets))).not.toBe('info');
  });

  it('生成中；部分出图待验收；两项满意为已完成；两张都失败为生成失败；完成后改方案回到方案待确认', () => {
    const { s } = approvedAndStarted();
    const id = s.work.id;
    expect(workStatusKey({ ...s, tasks: [task(id, 1, 0, 'running'), task(id, 1, 1, 'queued')] })).toBe('generating');
    expect(workStatusKey({ ...s, tasks: [task(id, 1, 0, 'succeeded'), task(id, 1, 1, 'running')] })).toBe('generating');
    const done = [task(id, 1, 0, 'succeeded'), task(id, 1, 1, 'failed')];
    expect(workStatusKey({ ...s, tasks: done, results: [result(id, 1, 0)] })).toBe('review');
    expect(workStatusKey({ ...s, tasks: done, results: [result(id, 1, 0, { real: 'ok', style: 'ok' })] })).toBe('done');
    expect(workStatusKey({ ...s, tasks: [task(id, 1, 0, 'failed'), task(id, 1, 1, 'failed')] })).toBe('failed');
    expect(workStatusKey({ ...s, work: setRatio(s.work, '3:4'), results: [result(id, 1, 0, { real: 'ok', style: 'ok' })] })).toBe('plan');
  });
});

describe('作品状态：流程一，自己生成背景', () => {
  const base = () => {
    let work = withInfo(fresh());
    const assets = product(work.id);
    work = setBackdropMode(work, 'generate');
    return { work, assets };
  };

  it('共创中 → 总结待确认 → 背景待批准 → 背景生成中 → 背景待选定 → 方案待确认', () => {
    const b = base();
    const assets = b.assets;
    let work = b.work;
    expect(workStatusKey(stateOf(work, assets))).toBe('story');
    work = draftSummary(work, { express: '雨后青苔', feel: '安静', avoid: '' });
    expect(workStatusKey(stateOf(work, assets))).toBe('summary');
    work = confirmSummary(work);
    expect(workStatusKey(stateOf(work, assets))).toBe('backdropPlan');
    const running = [task(work.id, 1, 0, 'running', 1, 'backdrop'), task(work.id, 1, 1, 'running', 1, 'backdrop')];
    expect(workStatusKey(stateOf({ ...work, backdropRound: 1 }, assets, { tasks: running }))).toBe('backdropGenerating');
    const cands = [backdrop(work.id, 1, 0), backdrop(work.id, 1, 1)];
    const picking = { ...work, backdropRound: 1 };
    expect(workStatusKey(stateOf(picking, assets, { backdrops: cands }))).toBe('backdropPick');
    const picked = chooseBackdrop(picking, refOfBackdrop(cands[1]));
    expect(workStatusKey(stateOf(picked, assets, { backdrops: cands, backdrop: refOfBackdrop(cands[1]) }))).toBe('plan');
    // 选定后小间又把总结改回草稿：背景这一步不算完成
    const redrafted = draftSummary(picked, { express: '雨后青苔，更冷一点', feel: '安静', avoid: '' });
    expect(workStatusKey(stateOf(redrafted, assets, { backdrops: cands, backdrop: refOfBackdrop(cands[1]) }))).toBe('summary');
  });

  it('背景生成中先于其他状态显示', () => {
    const w = backdropPromptedWork();
    expect(workStatusKey(stateOf(w, [], { tasks: [task(w.id, 1, 0, 'queued', 1, 'backdrop')] }))).toBe('backdropGenerating');
  });
});

describe('流程二（套用模板）', () => {
  it('背景一进来就完成：先商品，再信息、摆放', () => {
    const work = fresh(BUILTIN);
    expect(work).toMatchObject({ flow: 'template', backdropMode: 'library', backdropId: BUILTIN });
    expect(workStatusKey(stateOf(work))).toBe('draft');
    const states = stepStates(stateOf(work));
    expect(states.backdrop).toBe('done');
    expect(currentStep(stateOf(work), states)).toBe('product');
    const assets = product(work.id);
    expect(currentStep(stateOf(work, assets))).toBe('info');
    expect(currentStep(stateOf(withInfo(work), assets))).toBe('placement');
  });

  it('流程二里改为自己生成：切到流程一，背景清空，已有的照片和信息保留（AC-06.6）', () => {
    const work = withInfo(fresh(BUILTIN));
    const w = setBackdropMode(work, 'generate');
    expect(w).toMatchObject({ flow: 'home', backdropMode: 'generate', backdropId: null });
    expect(w.info.category.value).toBe('耳饰');
    expect(currentStep(stateOf(w, product(w.id)))).toBe('backdrop');
  });
});

describe('步骤状态', () => {
  it('流程一的当前步骤按商品 → 信息 → 背景 → 摆放 → 出图', () => {
    const work = fresh();
    expect(currentStep(stateOf(work))).toBe('product');
    const assets = product(work.id);
    expect(currentStep(stateOf(work, assets))).toBe('info');
    expect(currentStep(stateOf(withInfo(work), assets))).toBe('backdrop');
  });

  it('批准后改动：摆放标失效，旧结果的出图标失效', () => {
    const { s } = approvedAndStarted();
    const done = { ...s, results: [result(s.work.id, 1, 0, { real: 'ok', style: 'ok' })] };
    expect(stepStates(done)).toEqual({ product: 'done', info: 'done', backdrop: 'done', placement: 'done', result: 'done' });
    const changed = { ...done, work: setRatio(s.work, '9:16') };
    expect(stepStates(changed)).toMatchObject({ placement: 'stale', result: 'stale' });
    expect(currentStep(changed)).toBe('placement');
  });
});
