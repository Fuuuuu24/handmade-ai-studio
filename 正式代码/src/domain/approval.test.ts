import { describe, expect, it } from 'vitest';
import { backdropPromptedWork, backdropWork, BUILTIN, current, currentBasis, product, promptedWork, readyWork, stateOf, task, upload, view, viewTask } from '@/test/fixtures';
import {
  approvalReminders,
  backdropApprovalBlockers,
  backdropApprovalStatus,
  backdropGenerationBlockers,
  backdropPromptStatus,
  backdropPromptWriteBlocker,
  promptWriteBlocker,
  sceneApprovalBlockers,
  sceneApprovalStatus,
  sceneGenerationBlockers,
  scenePromptStatus,
  scenePromptWriteBlocker,
} from './approval';
import { backdropBasisOf } from './snapshot';
import {
  acceptSuggestion,
  approveBackdrop,
  approveScene,
  chooseCandidate,
  dismissSuggestion,
  editPrompt,
  markPromptChecked,
  markUnknown,
  newWork,
  resolvePromptSync,
  setImageModel,
  setInfo,
  setRatio,
  setStyle,
  startBackdropRound,
  startSceneRound,
  suggestInfo,
  chooseLibraryBackdrop,
  writePrompt,
} from './work';

const texts = (bs: { text: string }[]) => bs.map((b) => b.text);

describe('合成批准前还缺什么（sceneApprovalBlockers）', () => {
  it('新作品按步骤列出缺什么', () => {
    const work = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
    const bs = sceneApprovalBlockers(stateOf(work));
    expect(bs.map((b) => b.step)).toEqual(['product', 'info', 'backdrop', 'placement', 'placement']);
    expect(texts(bs)).toEqual([
      '还缺正面、侧面、背面照片',
      '品类、材料、尺寸还没填（不知道可以标「未知」）',
      '还没选定背景图',
      '摆放还缺：摆放、构图',
      '合成提示词还没写',
    ]);
  });

  it('全部就绪且提示词有效时没有阻塞；readyWork 只缺合成提示词', () => {
    const { work, assets } = promptedWork();
    expect(sceneApprovalBlockers(stateOf(work, assets))).toEqual([]);
    const ready = readyWork();
    expect(texts(sceneApprovalBlockers(stateOf(ready.work, ready.assets)))).toEqual(['合成提示词还没写']);
  });

  it('信息标「未知」也算填好', () => {
    const { work: w0, assets } = promptedWork();
    const cleared = setInfo(w0, 'size', '');
    const mentionsSize = (w: typeof w0) => texts(sceneApprovalBlockers(stateOf(w, assets))).some((t) => t.includes('尺寸'));
    expect(mentionsSize(cleared)).toBe(true);
    expect(mentionsSize(markUnknown(cleared, 'size', true))).toBe(false);
  });

  it('三视图有一张没确认、还在生成时都不能批准（AC-02.3）', () => {
    const { work } = promptedWork();
    const photos = (['front', 'side', 'back'] as const).map((k) => upload(work.id, k));
    const views = [view(photos[0]), view(photos[1]), view(photos[2], { confirmed: false })];
    expect(texts(sceneApprovalBlockers(stateOf(work, [...photos, ...views])))).toContain('三视图还没全部确认');
    const running = viewTask(work.id, 'back', photos[2].id, 'running');
    expect(texts(sceneApprovalBlockers(stateOf(work, [...photos, ...views], { tasks: [running] })))).toContain('三视图还在生成');
  });

  it('选的背景图找不到时如实说明；自己生成的背景还要共创总结已确认', () => {
    const { work, assets } = promptedWork();
    expect(texts(sceneApprovalBlockers(stateOf(work, assets, { backdrop: null })))).toContain('选定的背景图找不到了，请重新选一张');
    const own = { ...stateOf(work, assets).backdrop!, builtin: false, workId: work.id };
    expect(texts(sceneApprovalBlockers(stateOf(work, assets, { backdrop: own })))).toContain('共创总结还没确认');
  });

  it('摆放互相矛盾时不能批准', () => {
    const { work, assets } = promptedWork();
    const w = setStyle(setStyle(work, 'placement', '立在支架上', 'user'), 'bannedScene', '支架', 'user');
    expect(texts(sceneApprovalBlockers(stateOf(w, assets)))).toContain('摆放里有「支架」，但合成的「禁止出现」也写了「支架」');
  });

  it('合成生成中不能再批准', () => {
    const { work, assets } = promptedWork();
    const bs = sceneApprovalBlockers(stateOf(work, assets, { tasks: [task(work.id, 1, 0, 'running')] }));
    expect(bs).toEqual([{ step: 'result', text: '已有任务在生成中' }]);
  });

  it('写完提示词后改比例：提示词过期，说明改了什么', () => {
    const { work, assets } = promptedWork();
    const w = setRatio(work, '3:4');
    expect(scenePromptStatus(w, currentBasis(w, assets))).toEqual({ kind: 'stale', changed: ['比例'] });
    expect(texts(sceneApprovalBlockers(stateOf(w, assets)))).toEqual(['合成提示词写完后改了：比例，需要重写或确认']);
  });
});

describe('背景批准前还缺什么（backdropApprovalBlockers）', () => {
  it('用模板时不需要背景批准', () => {
    const { work, assets } = readyWork();
    expect(texts(backdropApprovalBlockers(stateOf(work, assets)))).toEqual(['背景选的是模板库里的，不需要生成']);
  });

  it('自己生成：没写背景提示词、缺风格、总结没确认时都挡；品类和尺寸要填或标未知', () => {
    const w = backdropWork();
    expect(texts(backdropApprovalBlockers(stateOf(w)))).toEqual(['背景提示词还没写']);
    const lacking = setStyle(setInfo(w, 'size', ''), 'light', '', 'user');
    expect(texts(backdropApprovalBlockers(stateOf(lacking)))).toEqual([
      '尺寸还没填（不知道可以标「未知」）',
      '背景风格还缺：光线',
      '背景提示词还没写',
    ]);
    // 材料不在背景依据里，不挡背景批准
    expect(texts(backdropApprovalBlockers(stateOf(setInfo(backdropPromptedWork(), 'material', ''))))).toEqual([]);
  });

  it('装饰道具和背景禁止项矛盾时不能批准', () => {
    const w = setStyle(setStyle(backdropPromptedWork(), 'props', '一小片苔藓', 'user'), 'bannedBackdrop', '苔藓', 'user');
    expect(texts(backdropApprovalBlockers(stateOf(w)))).toContain('道具里有「苔藓」，但背景的「禁止出现」也写了「苔藓」');
  });

  it('已经选定背景图时不能再批准生成，要先「重新设计背景」；背景或合成生成中也不能', () => {
    const w = chooseCandidate(backdropPromptedWork(), 'bd_x');
    expect(texts(backdropApprovalBlockers(stateOf(w, [], { backdrop: null })))).toEqual(['已经选定了背景图；要重新生成，先点「重新设计背景」']);
    const p = backdropPromptedWork();
    expect(texts(backdropApprovalBlockers(stateOf(p, [], { tasks: [task(p.id, 1, 0, 'running', 1, 'backdrop')] })))).toEqual(['背景正在生成中']);
    expect(texts(backdropApprovalBlockers(stateOf(p, [], { tasks: [task(p.id, 1, 0, 'running')] })))).toEqual(['正在合成这一轮候选，等结束后再生成背景']);
  });

  it('改了背景风格：背景提示词过期；改摆放、比例不影响背景提示词', () => {
    const w = backdropPromptedWork();
    expect(backdropPromptStatus(setStyle(w, 'light', '暖调午后光', 'user'))).toEqual({ kind: 'stale', changed: ['光线'] });
    expect(backdropPromptStatus(setRatio(setStyle(w, 'composition', '主体放大，突出细节', 'user'), '9:16'))).toEqual({ kind: 'ok' });
  });
});

describe('写提示词之前', () => {
  it('核心信息有小间建议没处理：写不了提示词，说明是哪几项；接受或忽略后可以写，售价的建议不挡（UX-02）', () => {
    const { work } = readyWork();
    const w = suggestInfo(suggestInfo(work, 'keep', '耳钩经小圆环连黄铜片'), 'material', '黄铜');
    expect(promptWriteBlocker(w)).toEqual({ step: 'info', text: '还有 2 条信息建议没处理：材料、不能改的细节' });
    expect(promptWriteBlocker(dismissSuggestion(acceptSuggestion(w, 'keep'), 'material'))).toBeNull();
    expect(promptWriteBlocker(suggestInfo(work, 'price', '198 元'))).toBeNull();
  });

  it('合成提示词要三视图都确认、背景图选定；背景提示词只在「自己生成」且没选定时', () => {
    const { work, assets } = readyWork();
    expect(scenePromptWriteBlocker(stateOf(work, assets))).toBeNull();
    expect(scenePromptWriteBlocker(stateOf(work, assets.slice(0, 3)))).toEqual({ step: 'product', text: '三视图还没全部确认' });
    expect(scenePromptWriteBlocker(stateOf({ ...work, backdropId: null }, assets))?.text).toBe('还没选定背景图');
    expect(backdropPromptWriteBlocker(work)?.text).toBe('背景选的是模板库里的，不需要写背景提示词');
    expect(backdropPromptWriteBlocker(backdropWork())).toBeNull();
    expect(backdropPromptWriteBlocker(chooseCandidate(backdropWork(), 'bd_x'))?.text).toBe('已经选定了背景图；要重新生成，先点「重新设计背景」');
  });

  it('为什么要挡：建议没处理时写的提示词，一接受就过期', () => {
    const { work, assets } = readyWork();
    const w = writePrompt(suggestInfo(work, 'keep', '两个圈不能变形'), 'scene', '……', currentBasis(work, assets));
    const accepted = acceptSuggestion(w, 'keep');
    expect(scenePromptStatus(accepted, currentBasis(accepted, assets))).toEqual({ kind: 'stale', changed: ['商品信息'] });
  });

  it('批准前提醒（不挡批准）：核心信息的建议还没处理；选填项的建议不提醒', () => {
    const { work, assets } = promptedWork();
    const w = suggestInfo(work, 'keep', '两个圈不能变形');
    expect(approvalReminders(w)).toEqual([{ step: 'info', text: '还有 1 条信息建议没处理：不能改的细节；没接受的不会用于生成' }]);
    expect(sceneApprovalBlockers(stateOf(w, assets))).toEqual([]);
    expect(approvalReminders(suggestInfo(work, 'audience', '送礼的年轻人'))).toEqual([]);
  });
});

describe('手改提示词的核对（AC-07.2），两段提示词一样', () => {
  it('手改后未核对不能批准；核对出矛盾仍不能批准；小间同步回风格后不判过期', () => {
    const { work: w0, assets } = promptedWork();
    const w1 = editPrompt(w0, 'scene', '我改过的提示词', currentBasis(w0, assets));
    expect(w1.prompt).toMatchObject({ edited: true, author: 'user', sync: 'unchecked' });
    expect(scenePromptStatus(w1, currentBasis(w1, assets)).kind).toBe('unchecked');
    const w2 = resolvePromptSync(w1, 'scene', ['提示词写了挂起来，方案是平铺'], currentBasis(w1, assets));
    expect(scenePromptStatus(w2, currentBasis(w2, assets))).toEqual({ kind: 'conflict', conflicts: ['提示词写了挂起来，方案是平铺'] });

    let w = editPrompt(w0, 'scene', '……悬挂在木架上……', currentBasis(w0, assets));
    w = setStyle(w, 'placement', '悬挂', 'said'); // 小间按手改写回方案卡
    w = resolvePromptSync(w, 'scene', [], currentBasis(w, assets));
    expect(scenePromptStatus(w, currentBasis(w, assets))).toEqual({ kind: 'ok' });
  });

  it('小间不可用时，用户并排核对后自己标「已核对」；背景提示词同样', () => {
    const { work: w0, assets } = promptedWork();
    const w1 = markPromptChecked(editPrompt(w0, 'scene', '我改过的提示词', currentBasis(w0, assets)), 'scene', currentBasis(w0, assets));
    expect(sceneApprovalBlockers(stateOf(w1, assets))).toEqual([]);
    const b0 = backdropPromptedWork();
    const b1 = editPrompt(b0, 'backdrop', '我改过的背景提示词', backdropBasisOf(b0));
    expect(texts(backdropApprovalBlockers(stateOf(b1)))).toEqual(['背景提示词改过，还没核对和方案是否一致']);
    expect(backdropApprovalBlockers(stateOf(markPromptChecked(b1, 'backdrop', backdropBasisOf(b1))))).toEqual([]);
  });
});

describe('批准是否有效、能不能发起生成', () => {
  function approved() {
    const { work, assets } = promptedWork();
    const a = approveScene(stateOf(work, assets));
    if (!a.ok) throw new Error('应当可以批准');
    return { work: a.work, approval: a.approval, assets };
  }

  it('合成批准后改核心信息、换背景图、换三视图都失效；改选填的售价不失效', () => {
    const { work, approval, assets } = approved();
    const st = (w: typeof work, a = assets) => sceneApprovalStatus(stateOf(w, a, { approval }));
    expect(st(work)).toEqual({ kind: 'valid' });
    expect(st(setInfo(work, 'price', '99 元'))).toEqual({ kind: 'valid' });
    expect(st(setInfo(work, 'material', '纯银'))).toEqual({ kind: 'stale', changed: ['商品信息'] });
    expect(st(chooseLibraryBackdrop(work, 'builtin:cream@1'))).toEqual({ kind: 'stale', changed: ['背景图'] });
    const redone = [...assets.slice(0, 5), view(assets[2])];
    expect(st(work, redone)).toEqual({ kind: 'stale', changed: ['三视图'] });
    expect(approval.snapshot.references).toEqual(assets.slice(3).map((a) => a.id));
    expect(approval.snapshot).toEqual(current(work, assets));
  });

  it('换生图模型：两种批准都失效，三视图和背景图不作废（AC-06.7）', () => {
    const { work, approval, assets } = approved();
    const w = setImageModel(work, 'img-b');
    expect(sceneApprovalStatus(stateOf(w, assets, { approval }))).toEqual({ kind: 'stale', changed: ['生图模型'] });
    expect(w.backdropId).toBe(BUILTIN);
    expect(currentBasis(w, assets).references).toHaveLength(3);
  });

  it('没有批准、批准已用过、正在生成时都不能发起合成', () => {
    const { work, approval, assets } = approved();
    expect(sceneGenerationBlockers(stateOf(work, assets))).toEqual(['方案还没批准']);
    expect(sceneGenerationBlockers(stateOf(work, assets, { approval, tasks: [task(work.id, 1, 0, 'running')] }))).toEqual(['已有任务在生成中']);
    const s = startSceneRound(stateOf(work, assets, { approval }), approval);
    if (!s.ok) throw new Error('应当可以生成');
    expect(s.round).toBe(1);
    expect(sceneGenerationBlockers(stateOf(s.work, assets, { approval: s.approval }))).toEqual(['这版批准已经生成过一轮，要再生成需重新批准']);
  });

  it('背景批准：改摆放不影响，改背景风格失效；一版批准只生成一轮', () => {
    const w = backdropPromptedWork();
    const a = approveBackdrop(stateOf(w));
    if (!a.ok) throw new Error('应当可以批准背景');
    expect(a.approval).toMatchObject({ kind: 'backdrop', version: 1, usedRound: null });
    expect(a.work.backdropApprovalId).toBe(a.approval.id);
    const st = (x: typeof w) => backdropApprovalStatus(stateOf(x, [], { backdropApproval: a.approval }));
    expect(st(setStyle(a.work, 'placement', '悬挂', 'user'))).toEqual({ kind: 'valid' });
    expect(st(setStyle(a.work, 'tone', '奶油米白', 'user'))).toEqual({ kind: 'stale', changed: ['色调'] });
    const s = startBackdropRound(stateOf(a.work, [], { backdropApproval: a.approval }), a.approval);
    if (!s.ok) throw new Error('应当可以生成背景');
    expect(s.work.backdropRound).toBe(1);
    expect(backdropGenerationBlockers(stateOf(s.work, [], { backdropApproval: s.approval }))).toEqual(['这版批准已经生成过一轮，要再生成需重新批准']);
  });

  it('背景生成中、合成生成中都不能再发起背景生成', () => {
    const w = backdropPromptedWork();
    const a = approveBackdrop(stateOf(w));
    if (!a.ok) throw new Error('应当可以批准背景');
    const with_ = (t: ReturnType<typeof task>) => backdropGenerationBlockers(stateOf(a.work, [], { backdropApproval: a.approval, tasks: [t] }));
    expect(with_(task(w.id, 1, 0, 'running', 1, 'backdrop'))).toEqual(['背景正在生成中']);
    expect(with_(task(w.id, 1, 0, 'running'))).toEqual(['正在合成这一轮候选，等结束后再生成背景']);
  });

  it('product 自检：三张原图、三张已确认的三视图', () => {
    expect(product('w').map((a) => `${a.origin}:${a.kind}`)).toEqual(['upload:front', 'upload:side', 'upload:back', 'view:front', 'view:side', 'view:back']);
  });
});
