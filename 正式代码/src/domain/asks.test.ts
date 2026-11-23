import { describe, expect, it } from 'vitest';
import { backdrop, backdropWork, BUILTIN, pickOwn, product, readyWork, result, stateOf, task, upload, view, viewTask } from '@/test/fixtures';
import { changedItems, checkActions, consentFound, markOf, waitingAsk } from './asks';
import { refOfBackdrop } from './backdrops';
import type { AskAction, Asset, WorkState } from './types';
import { confirmSummary, draftSummary, newWork, openAsk, setInfo, suggestInfo } from './work';

const ok = (s: WorkState, ...actions: AskAction[]) => {
  const c = checkActions(s, actions);
  if (!c.ok) throw new Error(c.reasons.join('；'));
  return c.items;
};
const reasons = (s: WorkState, ...actions: AskAction[]) => {
  const c = checkActions(s, actions);
  return c.ok ? [] : c.reasons;
};

// 三张原图，三视图都还没确认
function unconfirmed(): { s: WorkState; assets: Asset[] } {
  const { work } = readyWork();
  const assets = product(work.id).map((a) => (a.origin === 'view' ? { ...a, confirmed: false } : a));
  return { s: stateOf(work, assets), assets };
}

describe('每样能不能点：和画布按钮同一个条件（技术写法 14.4）', () => {
  it('三视图：没确认的可以问，记下是哪一张；确认过的、正在重做的不行', () => {
    const { s, assets } = unconfirmed();
    const [item] = ok(s, { type: 'confirm_view', angle: 'side' });
    const side = assets.find((a) => a.origin === 'view' && a.view === 'side')!;
    expect(item).toMatchObject({ text: '侧面三视图可以用', target: side.id, mark: `${side.id}|false` });

    const confirmedAll = stateOf(s.work, product(s.work.id));
    expect(reasons(confirmedAll, { type: 'confirm_view', angle: 'front' })).toEqual(['正面三视图已经确认过了']);
    const redo = { ...s, tasks: [viewTask(s.work.id, 'side', side.parentId!, 'running')] };
    expect(reasons(redo, { type: 'confirm_view', angle: 'side' })).toEqual(['侧面三视图正在重做，等新的一张出来再问']);
    expect(reasons(stateOf(s.work, [upload(s.work.id, 'front')]), { type: 'confirm_view', angle: 'front' })).toEqual(['正面还没有三视图']);
  });

  it('信息：有建议才能接受；生成中核心信息锁定，售价不锁；只有品类、材料、尺寸能标「未知」', () => {
    const { work, assets } = readyWork();
    const w = suggestInfo(suggestInfo(work, 'material', '925 银', '照片里看到'), 'price', '128 元');
    const s = stateOf(w, assets);
    expect(ok(s, { type: 'accept_info', field: 'material' })[0].text).toBe('材料用建议「925 银」');
    expect(reasons(s, { type: 'accept_info', field: 'size' })).toEqual(['尺寸没有待确认的建议']);
    const busy = { ...s, tasks: [task(w.id, 1, 0, 'running')] };
    expect(reasons(busy, { type: 'accept_info', field: 'material' })[0]).toContain('正在生成');
    expect(ok(busy, { type: 'accept_info', field: 'price' })).toHaveLength(1);
    expect(ok(s, { type: 'mark_unknown', field: 'size' })[0].text).toBe('尺寸标「未知」（现在填的「长 4.5cm」会清掉）');
    expect(reasons(s, { type: 'mark_unknown', field: 'keep' })).toEqual(['只有品类、材料、尺寸能标「未知」']);
  });

  it('共创总结：自己生成背景、有草稿才能确认；确认过的、用模板的不行', () => {
    const draft = draftSummary(backdropWork(), { express: '雨后青苔', feel: '安静', avoid: '' });
    expect(ok(stateOf(draft), { type: 'confirm_summary' })[0].text).toBe('确认共创总结：表达「雨后青苔」；感受「安静」；避免「未写」');
    expect(reasons(stateOf(confirmSummary(draft)), { type: 'confirm_summary' })).toEqual(['共创总结已经确认过了']);
    expect(reasons(stateOf(readyWork().work), { type: 'confirm_summary' })).toEqual(['背景用的是模板库里的，没有共创总结要确认']);
  });

  it('背景候选：只能选最新一轮已经出来的；同一条请求里先选定再沉淀', () => {
    const w = { ...backdropWork(), backdropRound: 2 };
    const old = backdrop(w.id, 1, 0);
    const b1 = backdrop(w.id, 2, 0);
    const s = stateOf(w, [], { backdrops: [old, b1] });
    expect(reasons(s, { type: 'pick_backdrop', round: 1, candidate: 1 })).toEqual(['只能选最新一轮（第 2 轮）的背景']);
    expect(reasons(s, { type: 'pick_backdrop', round: 2, candidate: 2 })).toEqual(['第 2 轮背景 2 还没有生成出来']);
    const items = ok(s, { type: 'pick_backdrop', round: 2, candidate: 1 }, { type: 'save_backdrop', name: ' 苔绿晨光 ' });
    expect(items.map((i) => [i.text, i.target])).toEqual([
      ['用第 2 轮背景 1', b1.id],
      ['第 2 轮背景 1 沉淀进模板库，起名「苔绿晨光」', b1.id],
    ]);
    // 只问沉淀：要先选定
    expect(reasons(s, { type: 'save_backdrop', name: '苔绿晨光' })).toEqual(['还没选定背景图，要先选定一张再沉淀']);
    // 已经选定的不用再选；已经沉淀过的不能再沉淀
    const picked = stateOf(pickOwn(w, b1.id), [], { backdrops: [old, { ...b1, savedAt: 5 }], backdrop: refOfBackdrop(b1) });
    expect(reasons(picked, { type: 'pick_backdrop', round: 2, candidate: 1 })).toEqual(['第 2 轮背景 1 已经选定了']);
    expect(reasons(picked, { type: 'save_backdrop', name: '苔绿晨光' })).toEqual(['第 2 轮背景 1 已经沉淀过了']);
    // 背景生成中不能选
    expect(reasons({ ...s, tasks: [task(w.id, 3, 0, 'running', 1, 'backdrop')] }, { type: 'pick_backdrop', round: 2, candidate: 1 })).toEqual(['背景正在生成中，等两张背景出来后再选']);
  });

  it('选的是内置模板时不能沉淀', () => {
    const { work, assets } = readyWork();
    expect(reasons(stateOf(work, assets), { type: 'save_backdrop', name: '雨后' })).toEqual(['选定的不是这件作品生成的背景图，只有自己生成的才能沉淀进模板库']);
  });

  it('验收：至少填一项；和现在一样的不用问', () => {
    const { work, assets } = readyWork();
    const r = result(work.id, 1, 1, { real: 'ok', style: 'none' });
    const s = stateOf(work, assets, { results: [r] });
    expect(ok(s, { type: 'verdict', round: 1, candidate: 2, real: 'ok', style: 'bad' })[0]).toMatchObject({ text: '第 1 轮候选 2 验收：像实物「像」，风格「不对」', target: r.id });
    expect(reasons(s, { type: 'verdict', round: 1, candidate: 2, real: 'ok' })).toEqual(['第 1 轮候选 2 的验收本来就是这样']);
    expect(reasons(s, { type: 'verdict', round: 1, candidate: 2 })[0]).toContain('至少要填一项');
    expect(reasons(s, { type: 'verdict', round: 1, candidate: 1, real: 'ok' })).toEqual(['没有第 1 轮候选 1 的结果']);
  });

  it('改流程：只有套用模板的作品要问；首页开始的直接改做法', () => {
    const template = newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId: BUILTIN });
    expect(ok(stateOf(template), { type: 'switch_flow' })).toHaveLength(1);
    expect(reasons(stateOf(readyWork().work), { type: 'switch_flow' })[0]).toContain('set_backdrop_mode');
  });

  it('同一样不能问两次；同一项信息「接受建议」和「标未知」只能二选一', () => {
    const { work, assets } = readyWork();
    const s = stateOf(suggestInfo(work, 'size', '长 3cm'), assets);
    expect(reasons(s, { type: 'accept_info', field: 'size' }, { type: 'mark_unknown', field: 'size' })).toEqual(['第 2 样和前面的重复了']);
  });
});

describe('问过之后变了的就作废（技术写法 14.4 第 3 条）', () => {
  it('用户自己点了、建议换了、总结改了、又生成了新的三视图：都算变了', () => {
    const { s, assets } = unconfirmed();
    const w = draftSummary(suggestInfo(s.work, 'material', '925 银'), { express: '雨后', feel: '', avoid: '' });
    const base = stateOf({ ...w, backdropMode: 'generate' }, assets);
    const items = ok(base, { type: 'confirm_view', angle: 'front' }, { type: 'accept_info', field: 'material' }, { type: 'confirm_summary' });
    expect(changedItems(base, items)).toEqual([]);

    const front = assets.find((a) => a.origin === 'view' && a.view === 'front')!;
    const userConfirmed = stateOf(base.work, assets.map((a) => (a.id === front.id ? { ...a, confirmed: true } : a)));
    expect(changedItems(userConfirmed, items).map((i) => i.text)).toEqual(['正面三视图可以用']);
    const redone = stateOf(base.work, [...assets, view(assets.find((a) => a.kind === 'front' && a.origin === 'upload')!, { confirmed: false, createdAt: Date.now() + 1000 })]);
    expect(changedItems(redone, items).map((i) => i.text)).toEqual(['正面三视图可以用']);
    const newSuggestion = stateOf(suggestInfo(base.work, 'material', '纯银'), assets);
    expect(changedItems(newSuggestion, items).map((i) => i.action.type)).toEqual(['accept_info']);
    const userTyped = stateOf(setInfo(base.work, 'material', '黄铜'), assets);
    expect(changedItems(userTyped, items).map((i) => i.action.type)).toEqual(['accept_info']);
    const confirmedByUser = stateOf(confirmSummary(base.work), assets);
    expect(changedItems(confirmedByUser, items).map((i) => i.action.type)).toEqual(['confirm_summary']);
  });

  it('沉淀看的是问的时候那一张：别处选了另一张不影响比较', () => {
    const w = { ...backdropWork(), backdropRound: 1 };
    const b1 = backdrop(w.id, 1, 0);
    const b2 = backdrop(w.id, 1, 1);
    const s = stateOf(pickOwn(w, b1.id), [], { backdrops: [b1, b2], backdrop: refOfBackdrop(b1) });
    const [save] = ok(s, { type: 'save_backdrop', name: '苔绿' });
    expect(markOf(s, save.action, save.target)).toBe(save.mark);
    expect(changedItems(stateOf(s.work, [], { backdrops: [{ ...b1, savedAt: 9 }, b2] }), [save])).toHaveLength(1);
  });
});

describe('同意的原话（技术写法 14.4 第 2 条）', () => {
  it('去掉空格和标点后逐字比对；一个字也行；找不到、空的不算', () => {
    expect(consentFound('同意！', ['同意'])).toBe(true);
    expect(consentFound('正面和背面可以', ['嗯，正面 和 背面可以，侧面我再看看'])).toBe(true);
    expect(consentFound('好', ['好'])).toBe(true);
    expect(consentFound('都可以', ['先不用'])).toBe(false);
    expect(consentFound('  ', ['同意'])).toBe(false);
    expect(consentFound('同意', [])).toBe(false);
  });

  it('正在等回复的只有一条', () => {
    const item = ok(stateOf(newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId: BUILTIN })), { type: 'switch_flow' });
    const w = openAsk(openAsk(readyWork().work, 'a', item), 'b', item);
    expect(waitingAsk(w)?.id).toBe('b');
    expect(waitingAsk(readyWork().work)).toBeUndefined();
  });
});
