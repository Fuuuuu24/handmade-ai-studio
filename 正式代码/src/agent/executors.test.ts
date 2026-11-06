import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '@/data/db';
import { loadContext } from '@/client/work-store';
import { addUpload, getShopStyle, getWork, listResults, listScenes, putTask, saveApproval, saveResult, saveShopStyle, saveWork } from '@/data/repo';
import type { Result } from '@/domain/types';
import { newId } from '@/domain/util';
import { acceptSuggestion, approve, confirmSummary, editPrompt, draftSummary, setStyle, startRound } from '@/domain/work';
import { currentBasis, readyWork, result, task } from '@/test/fixtures';
import { executeTool } from './executors';

const img = () => ({
  blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  width: 1600,
  height: 1200,
});

let userSaid: string[] = [];
const deps = { showStep: vi.fn(), userTexts: () => userSaid };

// 把 readyWork 存进测试库，素材用真实写入的那张
async function seed() {
  const { work } = readyWork();
  await saveWork(work);
  await addUpload(work.id, 'overall', img());
  return work;
}

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
    const w = await seed();
    const out = await executeTool(w.id, 'draft_summary', { express: '新的表达', feel: '安静', avoid: '' }, deps);
    expect(out.message).toContain('原来确认过的总结回到草稿');
    expect((await getWork(w.id))?.story.summaryState).toBe('draft');
  });

  it('生成中改风格被拒绝，并说明原因', async () => {
    const w = await seed();
    await putTask(task(w.id, 1, 0, 'running'));
    const out = await executeTool(w.id, 'set_style', { items: [{ field: 'light', value: '暖调午后光', basis: 'said' }] }, deps);
    expect(out).toEqual({ ok: false, message: '正在生成这一轮候选，方案锁定中；等生成结束后再改' });
    expect((await getWork(w.id))?.style.light.value).toBe('清冷晨光');
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
          { field: 'tone', value: '低饱和、偏冷灰', basis: 'said', quote: '冷灰' },
          { field: 'placement', value: '一对耳环单独立在石台上', basis: 'said' },
        ],
      },
      deps,
    );
    expect(out.message).toBe(
      '风格卡已更新：色调「低饱和、偏冷灰」（推荐，待确认）、摆放「一对耳环单独立在石台上」（推荐，待确认）。其中色调（「冷灰」）、摆放（没附原话）在用户的原话里没找到，已记为「小间推荐」，是建议、不是用户说的',
    );
    const saved = await getWork(w.id);
    expect(saved?.style.tone).toEqual({ value: '低饱和、偏冷灰', source: 'recommend', reason: undefined });
    expect(saved?.style.placement.source).toBe('recommend');
  });

  it('没有批准时 start_generation 被拒绝（PRD 4.2 第 1 条）', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'start_generation', {}, deps);
    expect(out.ok).toBe(false);
    expect(out.message).toBe('不能生成：方案还没批准');
  });

  it('request_approval 只放卡片、不批准，并列出还缺什么', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'request_approval', {}, deps);
    expect(out.message).toBe('批准卡片已放出，但还缺：提示词还没写');
    expect((await getWork(w.id))?.approvalId).toBeNull();
  });

  it('用户在小间回复时已经批准并开始生成：request_approval 说明不用再批准，生成完再说要怎样再来一轮（BC-009）', async () => {
    const w = await seed();
    await executeTool(w.id, 'draft_prompt', { prompt: '一对手作耳饰，严格按参考图还原颜色、数量、轮廓和连接结构，画面里不要任何文字。' }, deps);
    const ctx = await loadContext(w.id);
    const a = approve(ctx.work, ctx.assets, ctx.snapshot, false);
    if (!a.ok) throw new Error('应当可以批准');
    const s = startRound(a.work, a.approval, ctx.snapshot, false);
    if (!s.ok) throw new Error('应当可以生成');
    await saveApproval(s.work, s.approval);
    const running = { ...task(w.id, 1, 0, 'running'), approvalId: s.approval.id };
    await putTask(running);
    const out = await executeTool(w.id, 'request_approval', {}, deps);
    expect(out.message).toBe('用户已经批准了当前方案（第 1 版），第 1 轮正在生成，不需要再批准；等结果出来请用户验收');

    await putTask({ ...running, status: 'succeeded' });
    const after = await executeTool(w.id, 'request_approval', {}, deps);
    expect(after.message).toBe('当前方案已经批准过（第 1 版）并生成了第 1 轮；要按同一方案再生成一轮，需要用户在画布「方案」里再批准一次');
  });

  it('record_story 同样内容只记一次；draft_summary 内容没变时不把已确认的总结打回草稿（BC-007）', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'record_story', { kind: 'inspiration', text: '午后窗框投影' }, deps)).message).toBe('已记下：午后窗框投影');
    const again = await executeTool(w.id, 'record_story', { kind: 'inspiration', text: '午后窗框投影' }, deps);
    expect(again).toEqual({ ok: true, message: '这一条之前已经记下了，没有重复记录：午后窗框投影' });
    expect((await getWork(w.id))?.story.notes).toHaveLength(1);

    const same = await executeTool(w.id, 'draft_summary', { express: '雨后青苔', feel: '安静', avoid: '太花' }, deps);
    expect(same.message).toBe('总结和现在的一样，没有改动（仍是用户确认过的）');
    expect((await getWork(w.id))?.story.summaryState).toBe('confirmed');
  });

  it('没有待核对的手改时 resolve_prompt_sync 被拒绝；有手改时写回核对结果', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'resolve_prompt_sync', { conflicts: [] }, deps)).ok).toBe(false);
    const saved = (await getWork(w.id))!;
    await saveWork(editPrompt(saved, '用户自己写的提示词', currentBasis(saved, [])));
    const out = await executeTool(w.id, 'resolve_prompt_sync', { conflicts: ['提示词要暖光，方案是清冷晨光'] }, deps);
    expect(out.ok).toBe(true);
    expect((await getWork(w.id))?.prompt).toMatchObject({ sync: 'conflict', conflicts: ['提示词要暖光，方案是清冷晨光'] });
  });

  it('套用不存在的布景被拒绝；内置布景可以套用', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'apply_scene', { sceneId: 'nope' }, deps)).ok).toBe(false);
    expect((await executeTool(w.id, 'apply_scene', { sceneId: 'tpl-cream' }, deps)).message).toBe('已套用布景「午后书桌」');
    expect((await getWork(w.id))?.style.light.value).toBe('暖调午后光');
  });

  it('draft_prompt 记下依据，并提示批准前还缺什么', async () => {
    const w = await seed();
    await saveWork(draftSummary((await getWork(w.id))!, { express: '改了', feel: '', avoid: '' }));
    const out = await executeTool(w.id, 'draft_prompt', { prompt: '一件手作耳饰，黄铜镀金，完整入框留边距……' }, deps);
    expect(out.message).toContain('共创总结还没确认');
    await saveWork(confirmSummary((await getWork(w.id))!));
    const prompt = (await getWork(w.id))?.prompt;
    expect(prompt?.author).toBe('agent');
    expect(prompt?.basis.summary).toBeNull(); // 写的时候总结还是草稿，确认后提示词会被判为过期
  });

  it('核心信息还有建议没处理时 draft_prompt 被拒绝，不写提示词；处理完再写，接受后不过期（UX-02）', async () => {
    const w = await seed();
    // 用户纠正连接方式：小间同一轮先写建议、再写提示词（T03 的顺序）
    await executeTool(w.id, 'update_info', { items: [{ field: 'keep', value: '耳钩经小圆环连黄铜片', note: '你说的' }] }, deps);
    const refused = await executeTool(w.id, 'draft_prompt', { prompt: '一对黄铜耳饰，耳钩经小圆环连黄铜片……' }, deps);
    expect(refused).toEqual({
      ok: false,
      message: '没写提示词：还有 1 条信息建议没处理：不能改的细节。请用户先在「信息」里接受或忽略，处理完再写；现在写的话，一接受建议提示词就过期了',
    });
    expect((await getWork(w.id))?.prompt).toBeNull();

    await saveWork(acceptSuggestion((await getWork(w.id))!, 'keep'));
    const out = await executeTool(w.id, 'draft_prompt', { prompt: '一对黄铜耳饰，耳钩经小圆环连黄铜片……' }, deps);
    expect(out).toEqual({ ok: true, message: '已写好提示词，可以批准了', changes: ['提示词'] });
    const ctx = await loadContext(w.id);
    expect(ctx.work.prompt?.basis.info.keep.value).toBe('耳钩经小圆环连黄铜片');
    expect(ctx.work.prompt?.basis).toEqual(ctx.basis); // 依据就是现在的，不会判为过期
  });

  it('只有售价、目标顾客的建议没处理时照常写提示词', async () => {
    const w = await seed();
    await executeTool(w.id, 'update_info', { items: [{ field: 'price', value: '198 元' }] }, deps);
    const out = await executeTool(w.id, 'draft_prompt', { prompt: '一件手作耳饰，黄铜镀金，完整入框留边距……' }, deps);
    expect(out.ok).toBe(true);
    expect((await getWork(w.id))?.prompt?.author).toBe('agent');
  });

  it('show_step 切换画布', async () => {
    const w = await seed();
    await executeTool(w.id, 'show_step', { step: 'plan' }, deps);
    expect(deps.showStep).toHaveBeenCalledWith('plan');
  });
});

describe('小间的工具：起名', () => {
  it('suggest_name 只写名字建议，不改名（PRD 4.2 第 3 条）', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'suggest_name', { name: '银杏叶耳坠', note: '按品类起的' }, deps);
    expect(out.ok).toBe(true);
    const saved = await getWork(w.id);
    expect(saved?.name).toBe(w.name);
    expect(saved?.nameSuggestion?.value).toBe('银杏叶耳坠');
  });
});

describe('小间的工具：补全的 7 个', () => {
  async function withResult(verdict: Result['verdict'] = { real: 'none', style: 'none' }) {
    const w = await seed();
    const t = { ...task(w.id, 1, 0, 'succeeded') };
    const r = { ...result(w.id, 1, 0, verdict), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(3)], { type: 'image/jpeg' }));
    return { w, r };
  }

  it('note_feedback 只记问题和说明，不改验收（验收只能用户点）', async () => {
    const { w, r } = await withResult();
    const out = await executeTool(w.id, 'note_feedback', { round: 1, candidate: 1, issues: ['轮廓'], note: '链子变长了', revise: false }, deps);
    expect(out.ok).toBe(true);
    const [saved] = await listResults(w.id);
    expect(saved).toMatchObject({ id: r.id, issues: ['轮廓'], note: '链子变长了', verdict: { real: 'none', style: 'none' } });
    expect((await executeTool(w.id, 'note_feedback', { round: 2, candidate: 1, issues: [], revise: false }, deps)).ok).toBe(false);
  });

  it('offer_export：两项都满意的才放下载卡片', async () => {
    const { w } = await withResult({ real: 'ok', style: 'none' });
    expect((await executeTool(w.id, 'offer_export', { round: 1, candidate: 1 }, deps)).ok).toBe(false);
    const { w: w2 } = await withResult({ real: 'ok', style: 'ok' });
    expect((await executeTool(w2.id, 'offer_export', { round: 1, candidate: 1 }, deps)).ok).toBe(true);
  });

  it('retry_candidate：没失败的不能补', async () => {
    const { w } = await withResult();
    const out = await executeTool(w.id, 'retry_candidate', { round: 1, candidate: 1 }, deps);
    expect(out).toEqual({ ok: false, message: '不能补齐：这一张已经成功了' });
  });

  it('propose_scene_save 只放提议，不写布景；风格没选齐时拒绝；不能「更新」内置模版', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'propose_scene_save', { name: '青苔' }, deps)).ok).toBe(true);
    expect(await listScenes()).toEqual([]);
    expect((await executeTool(w.id, 'propose_scene_save', { name: '青苔', updateSceneId: 'tpl-moss' }, deps)).ok).toBe(false);
    await saveWork(setStyle((await getWork(w.id))!, 'light', '', 'user'));
    expect((await executeTool(w.id, 'propose_scene_save', { name: '青苔' }, deps)).message).toContain('光线');
  });

  it('propose_shop_style 只放提议，不写我的风格；和现有一样时拒绝（PRD 4.2 第 2 条）', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'propose_shop_style', { fields: ['light'], reason: '喜欢' }, deps)).ok).toBe(true);
    expect((await getShopStyle()).prefs).toEqual({});
    await saveShopStyle({ id: 'me', prefs: { light: '清冷晨光' }, history: [] });
    expect((await executeTool(w.id, 'propose_shop_style', { fields: ['light'], reason: '喜欢' }, deps)).ok).toBe(false);
  });

  it('set_image_model：生成中拒绝；换模型后旧批准失效靠快照比对', async () => {
    const w = await seed();
    expect((await executeTool(w.id, 'set_image_model', { model: 'gpt-image-2' }, deps)).ok).toBe(true);
    expect((await getWork(w.id))?.imageModel).toBe('gpt-image-2');
    await putTask(task(w.id, 1, 0, 'running'));
    expect((await executeTool(w.id, 'set_image_model', { model: 'qwen-image-3.0' }, deps)).ok).toBe(false);
  });

  it('make_white_asset：B 路线拒绝，不提交', async () => {
    const w = await seed();
    const out = await executeTool(w.id, 'make_white_asset', {}, deps);
    expect(out.ok).toBe(false);
    expect(out.message).toContain('原图路线');
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
