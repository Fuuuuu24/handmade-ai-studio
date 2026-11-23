import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, useTestDb } from '@/data/db';
import { loadContext } from '@/client/work-store';
import { addUpload, confirmView, getWork, listResults, listTasks, putTask, saveApproval, saveBackdropResult, saveResult, saveViewResult, saveWork } from '@/data/repo';
import type { Result, ViewAngle } from '@/domain/types';
import { newId } from '@/domain/util';
import { acceptSuggestion, approveScene, editPrompt, setBackdropMode, startSceneRound } from '@/domain/work';
import { backdrop, backdropWork, currentBasis, readyWork, result, task, viewTask } from '@/test/fixtures';
import { executeTool, LOCK_BACKDROP, LOCK_SCENE } from './executors';

const img = () => ({
  blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  width: 1600,
  height: 1200,
});

let userSaid: string[] = [];
const deps = { showStep: vi.fn(), userTexts: () => userSaid };
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
  userSaid = [];
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
    expect(out.message).toContain('重新设计背景');
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

  it('没有批准时 start_generation、start_backdrop_generation 都被拒绝（PRD 4.2 第 1 条）', async () => {
    const w = await seed();
    expect(await executeTool(w.id, 'start_generation', {}, deps)).toEqual({ ok: false, message: '不能生成：方案还没批准' });
    const b = backdropWork();
    await saveWork(b);
    expect(await executeTool(b.id, 'start_backdrop_generation', {}, deps)).toEqual({ ok: false, message: '不能生成背景：背景方案还没批准' });
    expect(await listTasks(b.id)).toEqual([]);
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
    expect(after.message).toBe('当前方案已经批准过（第 1 版）并生成了第 1 轮；要按同一方案再生成一轮，需要用户在「摆放」里再批准一次');
  });

  it('record_story 同样内容只记一次；draft_summary 内容没变时不把已确认的总结打回草稿（BC-007）', async () => {
    const w = backdropWork();
    await saveWork(w);
    expect((await executeTool(w.id, 'record_story', { kind: 'inspiration', text: '午后窗框投影' }, deps)).message).toBe('已记下：午后窗框投影');
    const again = await executeTool(w.id, 'record_story', { kind: 'inspiration', text: '午后窗框投影' }, deps);
    expect(again).toEqual({ ok: true, message: '这一条之前已经记下了，没有重复记录：午后窗框投影' });
    const same = await executeTool(w.id, 'draft_summary', { express: '雨后青苔', feel: '安静', avoid: '太花' }, deps);
    expect(same.message).toBe('总结和现在的一样，没有改动（仍是用户确认过的）');
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
      message: '没写合成提示词：还有 1 条信息建议没处理：不能改的细节。请用户先在「信息」里接受或忽略，处理完再写；现在写的话，一接受建议提示词就过期了',
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

  it('use_backdrop 只能选内置或已沉淀、没删除的；这件作品的候选只能用户点；合成中拒绝', async () => {
    const b = setBackdropMode(backdropWork(), 'generate');
    await saveWork(b);
    expect((await executeTool(b.id, 'use_backdrop', { backdropId: 'nope' }, deps)).message).toBe('没有编号为 nope 的背景图');
    const cand = backdrop(b.id, 1, 0);
    await saveBackdropResult({ ...task(b.id, 1, 0, 'succeeded', 1, 'backdrop'), id: cand.taskId }, cand, new Blob([new Uint8Array(4)]), new Blob([new Uint8Array(2)]));
    expect((await executeTool(b.id, 'use_backdrop', { backdropId: cand.id }, deps)).message).toContain('要由用户在画布上点「用这张」');
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

  it('suggest_name 只写名字建议，不改名（PRD 4.2 第 3 条）', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'suggest_name', { name: '银杏叶耳坠', note: '按品类起的' }, deps)).ok).toBe(true);
    const saved = await getWork(w.id);
    expect(saved?.name).toBe(w.name);
    expect(saved?.nameSuggestion?.value).toBe('银杏叶耳坠');
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

  it('retry_candidate 带类型：没失败的不能补', async () => {
    const { w } = await withResult();
    expect(await executeTool(w.id, 'retry_candidate', { kind: 'scene', round: 1, candidate: 1 }, deps)).toEqual({ ok: false, message: '不能补齐：这一张已经成功了' });
    expect(await executeTool(w.id, 'retry_candidate', { kind: 'backdrop', round: 1, candidate: 1 }, deps)).toEqual({ ok: false, message: '不能补齐：这一张还没有生成过' });
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
