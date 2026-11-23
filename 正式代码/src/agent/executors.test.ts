import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, useTestDb } from '@/data/db';
import { loadContext } from '@/client/work-store';
import { addUpload, confirmView, getBackdrop, getWork, listAssets, listResults, listTasks, putTask, saveApproval, saveBackdropResult, saveResult, saveViewResult, saveWork } from '@/data/repo';
import type { Result, ViewAngle } from '@/domain/types';
import { newId } from '@/domain/util';
import { acceptSuggestion, approveScene, editPrompt, newWork, queueHandoff, setBackdropMode, startSceneRound } from '@/domain/work';
import { backdrop, backdropWork, BUILTIN, currentBasis, pickOwn, readyWork, result, task, viewTask } from '@/test/fixtures';
import { executeTool, LOCK_BACKDROP, LOCK_SCENE } from './executors';
import { agentTools } from './tools';

const img = () => ({
  blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  width: 1600,
  height: 1200,
});

let userSaid: string[] = [];
let saidAfter: string[] = []; // 小间问过之后用户说的话（不含系统代发的）
let answer = true; // 确认框里用户点「确认」还是「取消」
const deps = {
  showStep: vi.fn(),
  userTexts: () => userSaid,
  userTextsAfter: () => saidAfter,
  confirm: vi.fn(async () => answer),
  leave: vi.fn(),
};
const ANGLES: ViewAngle[] = ['front', 'side', 'back'];

// 三张原图，可选再加确认过的三视图（真实写进测试库）
async function seedProduct(workId: string, views = true) {
  for (const k of ANGLES) {
    const p = await addUpload(workId, k, img());
    if (views) await confirmView(await saveViewResult(viewTask(workId, k, p.id, 'succeeded'), p, k, img()));
  }
}

// readyWork：背景用内置模板，摆放选好，三视图都确认了；只缺合成提示词
async function seed() {
  const { work } = readyWork();
  await saveWork(work);
  await seedProduct(work.id);
  return work;
}

const PROMPT = '第 1 张是背景图，第 2—4 张是三视图；一对手作耳饰平铺在台面中央，严格按三视图还原颜色、数量、轮廓和连接结构，画面里不要任何文字。';

beforeEach(() => {
  useTestDb(newId('test'));
  deps.showStep.mockClear();
  deps.confirm.mockClear();
  deps.leave.mockClear();
  userSaid = [];
  saidAfter = [];
  answer = true;
});

describe('小间的工具：硬规则', () => {
  it('update_info 只写待确认建议，不改已确认的值（PRD 4.2 第 3 条）', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'update_info', { items: [{ field: 'material', value: '纯银', note: '照片里看到' }] }, deps);
    expect(out.ok).toBe(true);
    const saved = await getWork(w.id);
    expect(saved?.info.material.value).toBe('黄铜镀金');
    expect(saved?.info.material.suggestion?.value).toBe('纯银');
  });

  it('draft_summary 总是草稿，已确认的总结也会回到草稿等用户确认', async () => {
    const w = backdropWork();
    await saveWork(w);
    const out = await executeTool(w.id, 'draft_summary', { express: '新的表达', feel: '安静', avoid: '' }, deps);
    expect(out.message).toContain('原来确认过的总结回到草稿');
    expect((await getWork(w.id))?.story.summaryState).toBe('draft');
  });

  it('合成生成中改摆放被拒绝；背景生成中改背景风格被拒绝（技术写法 13.6）', async () => {
    const w = await seed();
    await putTask(task(w.id, 1, 0, 'running'));
    const out = await executeTool(w.id, 'set_style', { items: [{ field: 'placement', value: '悬挂', basis: 'recommend' }] }, deps);
    expect(out).toEqual({ ok: false, message: LOCK_SCENE });
    expect((await getWork(w.id))?.style.placement.value).toBe('平铺');

    const b = backdropWork();
    await saveWork(b);
    await putTask(task(b.id, 1, 0, 'running', 1, 'backdrop'));
    expect(await executeTool(b.id, 'set_style', { items: [{ field: 'light', value: '暖调午后光', basis: 'recommend' }] }, deps)).toEqual({ ok: false, message: LOCK_BACKDROP });
    // 摆放不在背景快照里，背景生成中照常能改
    expect((await executeTool(b.id, 'set_style', { items: [{ field: 'placement', value: '悬挂', basis: 'recommend' }] }, deps)).ok).toBe(true);
  });

  it('背景图选定后背景五项以背景图为准，不能改（技术写法 13.4）', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'set_style', { items: [{ field: 'tone', value: '奶油米白', basis: 'recommend' }] }, deps);
    expect(out.ok).toBe(false);
    expect(out.message).toContain('redesign_backdrop');
  });

  it('set_style 标「你说的」要能在用户原话里找到片段，卡片记下原话（BC-013）', async () => {
    const w = await seed();
    userSaid = ['想要安静的标本小屋，耳环平铺在石台上'];
    const out = await executeTool(w.id, 'set_style', { items: [{ field: 'placement', value: '一对耳环平铺在浅石台上', basis: 'said', quote: '平铺' }] }, deps);
    expect(out).toMatchObject({ ok: true, message: '风格卡已更新：摆放「一对耳环平铺在浅石台上」' });
    expect((await getWork(w.id))?.style.placement).toEqual({ value: '一对耳环平铺在浅石台上', source: 'said', quote: '平铺' });
  });

  it('set_style 的原话找不到或没附原话：记为「小间推荐」，并说明是建议、不是用户说的（BC-013）', async () => {
    const w = await seed();
    userSaid = ['想要安静的标本小屋，不要把耳环丢进植物堆'];
    const out = await executeTool(
      w.id,
      'set_style',
      {
        items: [
          { field: 'bannedScene', value: '冷灰色调', basis: 'said', quote: '冷灰' },
          { field: 'placement', value: '一对耳环单独立在石台上', basis: 'said' },
        ],
      },
      deps,
    );
    expect(out.message).toBe(
      '风格卡已更新：合成禁止项「冷灰色调」（推荐，待确认）、摆放「一对耳环单独立在石台上」（推荐，待确认）。其中合成禁止项（「冷灰」）、摆放（没附原话）在用户的原话里没找到，已记为「小间推荐」，是建议、不是用户说的',
    );
    const saved = await getWork(w.id);
    expect(saved?.style.bannedScene).toEqual({ value: '冷灰色调', source: 'recommend', reason: undefined });
    expect(saved?.style.placement.source).toBe('recommend');
  });

  it('小间没有能发起生成的工具：批准和生成是同一下，只由用户滑动（PRD 4.2 第 1 条，技术写法 14.6）', async () => {
    const names = Object.keys(agentTools);
    expect(names).toHaveLength(27);
    expect(names.filter((n) => /start|generat|approve/.test(n))).toEqual([]);
    const w = await seed();
    await executeTool(w.id, 'draft_prompt', { prompt: PROMPT }, deps);
    expect((await executeTool(w.id, 'request_approval', { kind: 'scene' }, deps)).message).toBe('批准卡片已放出，等用户滑动「批准并生成」');
    expect(await getWork(w.id)).toMatchObject({ approvalId: null, round: 0 });
    expect(await listTasks(w.id)).toHaveLength(3); // 只有三视图的任务
  });

  it('request_approval 只放卡片、不批准，并列出还缺什么；用模板时没有背景批准', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'request_approval', { kind: 'scene' }, deps)).message).toBe('批准卡片已放出，但还缺：合成提示词还没写');
    expect((await getWork(w.id))?.approvalId).toBeNull();
    expect(await executeTool(w.id, 'request_approval', { kind: 'backdrop' }, deps)).toEqual({ ok: false, message: '背景用的是模板库里的，不需要背景批准' });
    const b = backdropWork();
    await saveWork(b);
    expect((await executeTool(b.id, 'request_approval', { kind: 'backdrop' }, deps)).message).toBe('背景批准卡片已放出，但还缺：背景提示词还没写');
  });

  it('用户在小间回复时已经批准并开始生成：request_approval 说明不用再批准，生成完再说要怎样再来一轮（BC-009）', async () => {
    const w = await seed();
    await executeTool(w.id, 'draft_prompt', { prompt: PROMPT }, deps);
    const ctx = await loadContext(w.id);
    const a = approveScene(ctx);
    if (!a.ok) throw new Error('应当可以批准');
    const s = startSceneRound({ ...ctx, work: a.work }, a.approval);
    if (!s.ok) throw new Error('应当可以生成');
    await saveApproval(s.work, s.approval);
    const running = { ...task(w.id, 1, 0, 'running'), approvalId: s.approval.id };
    await putTask(running);
    const out = await executeTool(w.id, 'request_approval', { kind: 'scene' }, deps);
    expect(out.message).toBe('用户已经批准了当前方案（第 1 版），第 1 轮正在生成，不需要再批准；等结果出来请用户验收');
    await putTask({ ...running, status: 'succeeded' });
    const after = await executeTool(w.id, 'request_approval', { kind: 'scene' }, deps);
    expect(after.message).toBe('当前方案已经批准过（第 1 版）并生成了第 1 轮；要按同一方案再生成一轮，需要用户在「摆放」里再滑一次「批准并生成」');
  });

  it('record_story 同样内容只记一次；draft_summary 内容没变时不把已确认的总结打回草稿（BC-007）', async () => {
    const w = backdropWork();
    await saveWork(w);
    expect((await executeTool(w.id, 'record_story', { kind: 'inspiration', text: '午后窗框投影' }, deps)).message).toBe('已记下：午后窗框投影');
    const again = await executeTool(w.id, 'record_story', { kind: 'inspiration', text: '午后窗框投影' }, deps);
    expect(again).toEqual({ ok: true, message: '这一条之前已经记下了，没有重复记录：午后窗框投影' });
    const same = await executeTool(w.id, 'draft_summary', { express: '雨后青苔', feel: '安静', avoid: '太花' }, deps);
    expect(same.message).toBe('总结和现在的一样，没有改动（仍是确认过的）');
  });

  it('resolve_prompt_sync 按段落核对：没有待核对的手改时拒绝；有手改时写回核对结果', async () => {
    const w = await seed();
    expect(await executeTool(w.id, 'resolve_prompt_sync', { which: 'scene', conflicts: [] }, deps)).toEqual({ ok: false, message: '合成提示词没有待核对的手改' });
    const saved = (await getWork(w.id))!;
    const ctx = await loadContext(w.id);
    await saveWork(editPrompt(saved, 'scene', '用户自己写的提示词', currentBasis(saved, ctx.assets)));
    const out = await executeTool(w.id, 'resolve_prompt_sync', { which: 'scene', conflicts: ['提示词要悬挂，方案是平铺'] }, deps);
    expect(out.ok).toBe(true);
    expect((await getWork(w.id))?.prompt).toMatchObject({ sync: 'conflict', conflicts: ['提示词要悬挂，方案是平铺'] });
    expect((await executeTool(w.id, 'resolve_prompt_sync', { which: 'backdrop', conflicts: [] }, deps)).message).toBe('背景提示词没有待核对的手改');
  });

  it('draft_prompt 要三视图都确认、背景图选定；记下依据，可以批准', async () => {
    const { work } = readyWork();
    await saveWork(work);
    await seedProduct(work.id, false);
    expect(await executeTool(work.id, 'draft_prompt', { prompt: PROMPT }, deps)).toEqual({ ok: false, message: '没写合成提示词：三视图还没全部确认' });
    const w = await seed();
    const out = await executeTool(w.id, 'draft_prompt', { prompt: PROMPT }, deps);
    expect(out).toEqual({ ok: true, message: '已写好合成提示词，可以请用户批准了', changes: ['合成提示词'] });
    const ctx = await loadContext(w.id);
    expect(ctx.work.prompt?.basis).toEqual(ctx.basis);
    expect(ctx.work.prompt?.basis.references).toHaveLength(3);
  });

  it('核心信息还有建议没处理时 draft_prompt 被拒绝；处理完再写，接受后不过期（UX-02）', async () => {
    const w = await seed();
    await executeTool(w.id, 'update_info', { items: [{ field: 'keep', value: '耳钩经小圆环连黄铜片', note: '你说的' }] }, deps);
    expect(await executeTool(w.id, 'draft_prompt', { prompt: PROMPT }, deps)).toEqual({
      ok: false,
      message:
        '没写合成提示词：还有 1 条信息建议没处理：不能改的细节。先处理建议：用户在「信息」里接受或忽略，或你用 ask_confirm 问过、他同意后代点，也可以用 update_info 撤回；处理完再写，现在写的话，建议一接受提示词就过期了',
    });
    expect((await getWork(w.id))?.prompt).toBeNull();
    await saveWork(acceptSuggestion((await getWork(w.id))!, 'keep'));
    expect((await executeTool(w.id, 'draft_prompt', { prompt: PROMPT }, deps)).ok).toBe(true);
    const ctx = await loadContext(w.id);
    expect(ctx.work.prompt?.basis.info.keep.value).toBe('耳钩经小圆环连黄铜片');
  });

  it('draft_backdrop_prompt 只在「自己生成」、背景还没选定时；写好后可以请用户批准背景', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'draft_backdrop_prompt', { prompt: '一张不含任何饰品的苔绿手工纸背景，清冷晨光' }, deps)).message).toBe(
      '没写背景提示词：背景选的是模板库里的，不需要写背景提示词',
    );
    const b = backdropWork();
    await saveWork(b);
    const out = await executeTool(b.id, 'draft_backdrop_prompt', { prompt: '一张不含任何饰品的苔绿手工纸背景，清冷晨光' }, deps);
    expect(out).toEqual({ ok: true, message: '已写好背景提示词，可以请用户批准了', changes: ['背景提示词'] });
    expect((await loadContext(b.id)).work.backdropPrompt?.basis).toEqual((await loadContext(b.id)).backdropBasis);
  });
});

describe('小间的工具：三视图和背景图（技术写法 13.7）', () => {
  it('propose_views 只放卡片、不生成；缺照片时拒绝并说明缺哪张', async () => {
    const { work } = readyWork();
    await saveWork(work);
    await addUpload(work.id, 'front', img());
    expect(await executeTool(work.id, 'propose_views', {}, deps)).toEqual({ ok: false, message: '不能生成三视图：还缺侧面、背面照片，三张都有才能生成三视图' });
    await addUpload(work.id, 'side', img());
    await addUpload(work.id, 'back', img());
    const out = await executeTool(work.id, 'propose_views', {}, deps);
    expect(out.ok).toBe(true);
    expect(out.message).toContain('用户点了才生成');
    expect(await listTasks(work.id)).toEqual([]);
  });

  it('use_backdrop 只能选内置或已沉淀、没删除的；这件作品的候选要先问用户；合成中拒绝', async () => {
    const b = setBackdropMode(backdropWork(), 'generate');
    await saveWork(b);
    expect((await executeTool(b.id, 'use_backdrop', { backdropId: 'nope' }, deps)).message).toBe('没有编号为 nope 的背景图');
    const cand = backdrop(b.id, 1, 0);
    await saveBackdropResult({ ...task(b.id, 1, 0, 'succeeded', 1, 'backdrop'), id: cand.taskId }, cand, new Blob([new Uint8Array(4)]), new Blob([new Uint8Array(2)]));
    expect((await executeTool(b.id, 'use_backdrop', { backdropId: cand.id }, deps)).message).toContain('用 ask_confirm（pick_backdrop）问用户');
    // 从「自己生成」换成模板：结果里写明做法变了（评审第 2 条）
    const out = await executeTool(b.id, 'use_backdrop', { backdropId: 'builtin:cream@1' }, deps);
    expect(out).toEqual({
      ok: true,
      message: '已选用背景图「午后书桌」（内置模板，暂无参数）；背景做法从「自己生成」换成了「用模板库里的」',
      changes: ['背景图「午后书桌」'],
    });
    expect(await getWork(b.id)).toMatchObject({ backdropId: 'builtin:cream@1', backdropMode: 'library' });
    expect((await executeTool(b.id, 'use_backdrop', { backdropId: 'builtin:rose@1' }, deps)).message).toBe('已选用背景图「温柔礼物」（内置模板，暂无参数）；背景做法仍是「用模板库里的」');
    expect((await executeTool(b.id, 'use_backdrop', { backdropId: 'builtin:rose@1' }, deps)).message).toBe('背景本来就是「温柔礼物」');
    await putTask(task(b.id, 1, 0, 'running'));
    expect(await executeTool(b.id, 'use_backdrop', { backdropId: 'builtin:moss@1' }, deps)).toEqual({ ok: false, message: LOCK_SCENE });
  });

  it('use_backdrop：背景生成中拒绝；选这件作品沉淀过的背景，做法跟着变成「自己生成」（评审第 1、2 条）', async () => {
    const b = setBackdropMode(backdropWork(), 'generate');
    await saveWork(b);
    const own = backdrop(b.id, 1, 0, { savedAt: 1, name: '苔绿晨光' });
    await saveBackdropResult({ ...task(b.id, 1, 0, 'succeeded', 1, 'backdrop'), id: own.taskId }, own, new Blob([new Uint8Array(4)]), new Blob([new Uint8Array(2)]));
    await putTask(task(b.id, 2, 0, 'running', 1, 'backdrop'));
    expect(await executeTool(b.id, 'use_backdrop', { backdropId: 'builtin:cream@1' }, deps)).toEqual({ ok: false, message: LOCK_BACKDROP });
    expect((await getWork(b.id))?.backdropId).toBeNull();
    await db().tasks.clear();
    await saveWork({ ...(await getWork(b.id))!, backdropMode: 'library' });
    const out = await executeTool(b.id, 'use_backdrop', { backdropId: own.id }, deps);
    expect(out.message).toBe('已选用背景图「苔绿晨光」（这件作品生成的）；背景做法从「用模板库里的」换成了「自己生成」');
    expect(await getWork(b.id)).toMatchObject({ backdropId: own.id, backdropMode: 'generate', flow: 'home' });
  });

  it('show_step 切换画布，步骤用编号', async () => {
    const w = await seed();
    await executeTool(w.id, 'show_step', { step: 'placement' }, deps);
    expect(deps.showStep).toHaveBeenCalledWith('placement');
  });
});

describe('小间的工具：其余的', () => {
  async function withResult(verdict: Result['verdict'] = { real: 'none', style: 'none' }) {
    const w = await seed();
    const t = { ...task(w.id, 1, 0, 'succeeded') };
    const r = { ...result(w.id, 1, 0, verdict), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(3)], { type: 'image/jpeg' }));
    return { w, r };
  }

  it('rename_work 直接改名（技术写法 14.3）；和现名一样时不改', async () => {
    const w = await seed();
    expect(await executeTool(w.id, 'rename_work', { name: ' 银杏叶耳坠 ' }, deps)).toEqual({ ok: true, message: '作品改名为「银杏叶耳坠」', changes: ['作品名「银杏叶耳坠」'] });
    expect((await getWork(w.id))?.name).toBe('银杏叶耳坠');
    expect((await executeTool(w.id, 'rename_work', { name: '银杏叶耳坠' }, deps)).message).toBe('作品本来就叫「银杏叶耳坠」');
  });

  it('note_feedback 只记问题和说明，不改验收（验收只能用户点）', async () => {
    const { w, r } = await withResult();
    const out = await executeTool(w.id, 'note_feedback', { round: 1, candidate: 1, issues: ['轮廓'], note: '链子变长了', revise: false }, deps);
    expect(out.ok).toBe(true);
    const [saved] = await listResults(w.id);
    expect(saved).toMatchObject({ id: r.id, issues: ['轮廓'], note: '链子变长了', verdict: { real: 'none', style: 'none' } });
    expect((await executeTool(w.id, 'note_feedback', { round: 2, candidate: 1, issues: [], revise: false }, deps)).ok).toBe(false);
  });

  it('offer_export：两项都满意的才放下载卡片，并提醒发布时声明（PRD AC-10.5）', async () => {
    const { w } = await withResult({ real: 'ok', style: 'none' });
    expect((await executeTool(w.id, 'offer_export', { round: 1, candidate: 1 }, deps)).ok).toBe(false);
    const { w: w2 } = await withResult({ real: 'ok', style: 'ok' });
    const out = await executeTool(w2.id, 'offer_export', { round: 1, candidate: 1 }, deps);
    expect(out.ok).toBe(true);
    expect(out.message).toContain('声明是 AI 生成的图');
  });

  it('propose_retry 只放「补齐这一张」卡片、不补；没失败的不能补（技术写法 14.6）', async () => {
    const { w } = await withResult();
    expect(await executeTool(w.id, 'propose_retry', { kind: 'scene', round: 1, candidate: 1 }, deps)).toEqual({ ok: false, message: '不能补齐第 1 轮候选 1：这一张已经成功了' });
    expect(await executeTool(w.id, 'propose_retry', { kind: 'backdrop', round: 1, candidate: 1 }, deps)).toEqual({ ok: false, message: '不能补齐第 1 轮背景 1：这一张还没有生成过' });
  });

  it('propose_retry：失败的一张、批准仍有效时放卡片，任务不增加；批准后改了方案就不能补', async () => {
    const w = await seed();
    await executeTool(w.id, 'draft_prompt', { prompt: PROMPT }, deps);
    const ctx = await loadContext(w.id);
    const a = approveScene(ctx);
    if (!a.ok) throw new Error('应当可以批准');
    const st = startSceneRound({ ...ctx, work: a.work }, a.approval);
    if (!st.ok) throw new Error('应当可以生成');
    await saveApproval(st.work, st.approval);
    await putTask({ ...task(w.id, 1, 0, 'failed'), approvalId: st.approval.id });
    const before = (await listTasks(w.id)).length;
    expect(await executeTool(w.id, 'propose_retry', { kind: 'scene', round: 1, candidate: 1 }, deps)).toEqual({
      ok: true,
      message: '「补齐这一张」卡片已放出（第 1 轮候选 1），用户点了才补，要花一张图的钱',
    });
    expect(await listTasks(w.id)).toHaveLength(before);
    await executeTool(w.id, 'set_ratio', { ratio: '3:4' }, deps);
    expect((await executeTool(w.id, 'propose_retry', { kind: 'scene', round: 1, candidate: 1 }, deps)).message).toBe('不能补齐第 1 轮候选 1：批准后方案改过了，补齐需要重新批准');
  });

  it('set_image_model：任一种生成中拒绝；换模型后三视图和背景图照常可用（AC-06.7）', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'set_image_model', { model: 'gpt-image-2' }, deps);
    expect(out.ok).toBe(true);
    const ctx = await loadContext(w.id);
    expect([ctx.work.imageModel, ctx.work.backdropId, ctx.basis.references.length]).toEqual(['gpt-image-2', 'builtin:moss@1', 3]);
    await putTask(viewTask(w.id, 'front', 'x', 'running'));
    expect((await executeTool(w.id, 'set_image_model', { model: 'qwen-image-3.0' }, deps)).ok).toBe(false);
  });

  it('note_followup 记进后续需求，不进共创记录；重复的不重复记', async () => {
    const w = await seed();
    await executeTool(w.id, 'note_followup', { text: '真人佩戴图' }, deps);
    await executeTool(w.id, 'note_followup', { text: '真人佩戴图' }, deps);
    const saved = (await getWork(w.id))!;
    expect(saved.followups?.map((f) => f.text)).toEqual(['真人佩戴图']);
    expect(saved.story.notes).toEqual([]);
  });
});

describe('小间的操作权限（技术写法 14）', () => {
  // 三张原图，三视图都还没确认
  async function seedUnconfirmed() {
    const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
    await saveWork(w);
    for (const k of ANGLES) {
      const p = await addUpload(w.id, k, img());
      await saveViewResult(viewTask(w.id, k, p.id, 'succeeded'), p, k, img());
    }
    return w;
  }
  const confirmedAngles = async (workId: string) =>
    (await listAssets(workId))
      .filter((a) => a.origin === 'view' && a.confirmed)
      .map((a) => a.view)
      .sort();

  it('B 类：先问（ask_confirm 放卡片、记下请求），用户同意后才代点；没回复、原话找不到都不点', async () => {
    const w = await seedUnconfirmed();
    const items = [
      { type: 'confirm_view', angle: 'front' },
      { type: 'confirm_view', angle: 'side' },
    ];
    expect(await executeTool(w.id, 'ask_confirm', { items: [{ type: 'confirm_view' }] }, deps, 'call_ask')).toEqual({
      ok: false,
      message: '没放卡片：第 1 样：confirm_view 要填 angle',
    });
    expect((await executeTool(w.id, 'ask_confirm', { items }, deps)).message).toBe('没放卡片：缺这次调用的编号');
    const asked = await executeTool(w.id, 'ask_confirm', { items }, deps, 'call_ask');
    expect(asked.message).toContain('等用户回复：1. 正面三视图可以用；2. 侧面三视图可以用');
    expect((await getWork(w.id))?.asks?.call_ask.state).toBe('waiting');

    expect((await executeTool(w.id, 'confirm_for_user', { quote: '同意' }, deps)).message).toBe('问过之后用户还没回复，等他回复了再说');
    saidAfter = ['正面可以，侧面我再看看'];
    expect((await executeTool(w.id, 'confirm_for_user', { quote: '都可以' }, deps)).ok).toBe(false);
    expect(await confirmedAngles(w.id)).toEqual([]);
    expect(await executeTool(w.id, 'confirm_for_user', { quote: '正面可以', only: [1] }, deps)).toEqual({
      ok: true,
      message: '替用户点了：正面三视图可以用（用户说「正面可以」）',
      changes: ['正面三视图可以用'],
    });
    expect(await confirmedAngles(w.id)).toEqual(['front']);
  });

  it('B 类：点不了的不放卡片（和画布按钮同一个条件）', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'ask_confirm', { items: [{ type: 'accept_info', field: 'size' }, { type: 'confirm_summary' }] }, deps, 'call_x');
    expect(out).toEqual({ ok: false, message: '没放卡片，这几样现在点不了：尺寸没有待确认的建议；背景用的是模板库里的，没有共创总结要确认' });
    expect((await getWork(w.id))?.asks).toBeUndefined();
  });

  it('A 类：改照片类型不顶掉、不移走角度时直接改；C 类：会顶掉某个角度的照片时弹确认框，取消就不改', async () => {
    const w = await seed();
    const extra = await addUpload(w.id, 'unsorted', img());
    expect((await executeTool(w.id, 'set_photo_kind', { assetId: extra.id, kind: 'detail' }, deps)).ok).toBe(true);
    expect(deps.confirm).not.toHaveBeenCalled();

    answer = false;
    const out = await executeTool(w.id, 'set_photo_kind', { assetId: extra.id, kind: 'front' }, deps);
    expect(out).toEqual({ ok: false, message: '用户取消了，照片类型没改' });
    expect(deps.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '小间想替换正面照片？', ok: '替换' }));
    expect((await listAssets(w.id)).find((a) => a.id === extra.id)?.kind).toBe('detail');

    answer = true;
    expect((await executeTool(w.id, 'set_photo_kind', { assetId: extra.id, kind: 'front' }, deps)).message).toBe('这张细节照片改成「正面」；原来的正面照片退回「未分类」');
    const uploads = (await listAssets(w.id)).filter((a) => a.origin === 'upload');
    expect(uploads.filter((a) => a.kind === 'front').map((a) => a.id)).toEqual([extra.id]);
    expect(uploads.filter((a) => a.kind === 'unsorted')).toHaveLength(1);
  });

  it('C 类：停用照片、从模板库删除背景图都弹确认框，取消不执行，确认才执行', async () => {
    const w = await seed();
    const front = (await listAssets(w.id)).find((a) => a.origin === 'upload' && a.kind === 'front')!;
    answer = false;
    expect((await executeTool(w.id, 'request_delete', { target: 'photo', id: front.id }, deps)).message).toBe('用户取消了，这张正面照片照常在用');
    expect((await listAssets(w.id)).find((a) => a.id === front.id)?.removed).toBe(false);
    answer = true;
    expect((await executeTool(w.id, 'request_delete', { target: 'photo', id: front.id }, deps)).ok).toBe(true);
    expect((await listAssets(w.id)).find((a) => a.id === front.id)?.removed).toBe(true);

    const saved = backdrop('other', 1, 0, { name: '雨后清晨', savedAt: 5 });
    await saveBackdropResult({ ...task('other', 1, 0, 'succeeded', 1, 'backdrop'), id: saved.taskId }, saved, new Blob(['a']), new Blob(['b']));
    answer = false;
    expect((await executeTool(w.id, 'request_delete', { target: 'backdrop', id: saved.id }, deps)).message).toBe('用户取消了，「雨后清晨」还在模板库里');
    expect(deps.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: '小间想从模板库删除「雨后清晨」？', danger: true }));
    expect((await getBackdrop(saved.id))?.deletedAt).toBeNull();
    answer = true;
    expect((await executeTool(w.id, 'request_delete', { target: 'backdrop', id: saved.id }, deps)).ok).toBe(true);
    expect((await getBackdrop(saved.id))?.deletedAt).toBeGreaterThan(0);
    expect((await executeTool(w.id, 'request_delete', { target: 'backdrop', id: BUILTIN }, deps)).message).toBe('内置模板不能删除');
  });

  it('C 类：删除这件作品，用户确认后删掉并回作品页', async () => {
    const w = await seed();
    answer = false;
    expect((await executeTool(w.id, 'request_delete', { target: 'work' }, deps)).message).toBe('用户取消了，作品没删');
    expect(await getWork(w.id)).toBeDefined();
    expect(deps.leave).not.toHaveBeenCalled();
    answer = true;
    expect(await executeTool(w.id, 'request_delete', { target: 'work' }, deps)).toEqual({ ok: true, message: '作品已删除' });
    expect(await getWork(w.id)).toBeUndefined();
    expect(deps.leave).toHaveBeenCalledTimes(1);
  });

  it('next_step：没做完就拒绝；做完了画布切到下一步，记下交接快照，去掉这一步排着的交接（技术写法 14.7）', async () => {
    const w = await seed();
    expect(await executeTool(w.id, 'next_step', { step: 'placement' }, deps)).toEqual({ ok: false, message: '「摆放」还没做完：合成方案还没批准' });
    await saveWork(queueHandoff(queueHandoff((await getWork(w.id))!, 'product'), 'info'));
    const out = await executeTool(w.id, 'next_step', { step: 'product' }, deps);
    expect(out.message).toContain('已推进到「信息」，画布切过去了。「商品」这一页现在的内容：');
    expect(out.message).toContain('- 三视图：正面已确认、侧面已确认、背面已确认');
    expect(deps.showStep).toHaveBeenCalledWith('info');
    const saved = (await getWork(w.id))!;
    expect(saved.lastHandoff?.step).toBe('product');
    expect(saved.pendingHandoffs).toEqual(['info']);
  });

  it('背景做法：首页开始的直接换；套用模板改自己生成要先问；重新设计背景放开自己生成的那张', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'set_backdrop_mode', { mode: 'generate' }, deps)).message).toBe('背景做法改成「自己生成」；原来选的背景图「雨后清晨」清掉了，之后可以再选回来');
    expect(await getWork(w.id)).toMatchObject({ backdropMode: 'generate', backdropId: null, flow: 'home' });
    expect((await executeTool(w.id, 'redesign_backdrop', {}, deps)).message).toBe('还没选定背景图，不用重新设计');

    const t = newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId: BUILTIN });
    await saveWork(t);
    expect((await executeTool(t.id, 'set_backdrop_mode', { mode: 'generate' }, deps)).message).toContain('先用 ask_confirm（switch_flow）问用户');
    expect((await getWork(t.id))?.flow).toBe('template');
    expect((await executeTool(t.id, 'redesign_backdrop', {}, deps)).ok).toBe(false);

    const b = { ...backdropWork(), backdropRound: 1 };
    const own = backdrop(b.id, 1, 0, { name: '苔绿晨光' });
    await saveWork(pickOwn(b, own.id));
    await saveBackdropResult({ ...task(b.id, 1, 0, 'succeeded', 1, 'backdrop'), id: own.taskId }, own, new Blob(['a']), new Blob(['b']));
    expect((await executeTool(b.id, 'redesign_backdrop', {}, deps)).ok).toBe(true);
    expect((await getWork(b.id))?.backdropId).toBeNull();
  });

  it('rename_backdrop 只改模板库里自己沉淀的；update_info 能撤回自己的建议；record_story 能记「暂无明确故事」', async () => {
    const w = await seed();
    const saved = backdrop('other', 1, 0, { name: '雨后清晨', savedAt: 5 });
    const cand = backdrop('other', 1, 1);
    for (const b of [saved, cand]) await saveBackdropResult({ ...task('other', 1, b.slot, 'succeeded', 1, 'backdrop'), id: b.taskId }, b, new Blob(['a']), new Blob(['b']));
    expect((await executeTool(w.id, 'rename_backdrop', { backdropId: saved.id, name: '雨后清晨 2' }, deps)).ok).toBe(true);
    expect((await getBackdrop(saved.id))?.name).toBe('雨后清晨 2');
    expect((await executeTool(w.id, 'rename_backdrop', { backdropId: BUILTIN, name: 'x' }, deps)).message).toBe('内置模板不能改名');
    expect((await executeTool(w.id, 'rename_backdrop', { backdropId: cand.id, name: 'x' }, deps)).ok).toBe(false);

    await executeTool(w.id, 'update_info', { items: [{ field: 'size', value: '长 3cm' }] }, deps);
    const out = await executeTool(w.id, 'update_info', { withdraw: ['size', 'material'] }, deps);
    expect(out.message).toBe('已撤回建议：尺寸；材料没有待处理的建议');
    expect((await getWork(w.id))?.info.size).toEqual({ value: '长 4.5cm', unknown: false });

    const b = backdropWork();
    await saveWork(b);
    expect((await executeTool(b.id, 'record_story', { kind: 'other', text: '暂时没有特别的故事，想突出造型', noStory: true }, deps)).message).toBe(
      '已记下：暂时没有特别的故事，想突出造型；勾上了「暂无明确故事」',
    );
    expect((await getWork(b.id))?.story.noStory).toBe(true);
  });
});
