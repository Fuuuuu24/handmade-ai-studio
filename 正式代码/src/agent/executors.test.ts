import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '@/data/db';
import { addUpload, getWork, putTask, saveWork } from '@/data/repo';
import { newId } from '@/domain/util';
import { confirmSummary, editPrompt, draftSummary } from '@/domain/work';
import { currentBasis, readyWork, task } from '@/test/fixtures';
import { executeTool } from './executors';

const img = () => ({
  blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  width: 1600,
  height: 1200,
});

const deps = { showStep: vi.fn() };

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

  it('show_step 切换画布', async () => {
    const w = await seed();
    await executeTool(w.id, 'show_step', { step: 'plan' }, deps);
    expect(deps.showStep).toHaveBeenCalledWith('plan');
  });
});
