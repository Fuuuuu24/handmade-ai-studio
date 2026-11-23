import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from '@/data/db';
import { getBackdrop, getWork, putTask, saveBackdropResult, saveWork } from '@/data/repo';
import { newId } from '@/domain/util';
import { newWork, setBackdropMode } from '@/domain/work';
import { backdrop, task } from '@/test/fixtures';
import { deleteFromLibrary, pickBackdrop, renameBackdrop, resolveBackdrop, saveToLibrary } from './backdrops';

const blob = () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' });

async function store(workId: string, extra: Parameters<typeof backdrop>[3] = {}) {
  const b = backdrop(workId, 1, 0, extra);
  await saveBackdropResult({ ...task(workId, 1, 0, 'succeeded', 1, 'backdrop'), id: b.taskId }, b, blob(), blob());
  return b;
}

async function seed() {
  const w = setBackdropMode(newWork({ imageModel: 'img-a', chatModel: 'chat-a' }), 'generate');
  await saveWork(w);
  return w;
}

beforeEach(() => {
  useTestDb(newId('test'));
});

describe('选背景图、沉淀、改名、删除（画布按钮和小间共用，技术写法 14.3、14.4）', () => {
  it('这件作品的候选选定后做法不变；模板库里的选定后做法是「用模板库里的」', async () => {
    const w = await seed();
    const own = await store(w.id);
    expect(await pickBackdrop(w.id, own.id)).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: own.id, backdropMode: 'generate' });
    expect(await pickBackdrop(w.id, 'builtin:cream@1')).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: 'builtin:cream@1', backdropMode: 'library' });
  });

  it('别的作品没沉淀的候选选不了；从模板库删掉的不能再被新选，正在用它的作品照常（AC-06.4）', async () => {
    const w = await seed();
    const other = await store('work_other');
    expect(await pickBackdrop(w.id, other.id)).toEqual({ ok: false, reason: '这张背景图还没沉淀进模板库' });
    const saved = await store('work_other', { savedAt: 1 });
    expect(await pickBackdrop(w.id, saved.id)).toEqual({ ok: true });
    await deleteFromLibrary(saved.id);
    expect((await resolveBackdrop(saved.id))?.deleted).toBe(true);
    // 正在用它：照常可用，也能重新点它
    expect(await pickBackdrop(w.id, saved.id)).toEqual({ ok: true });
    const w2 = await seed();
    expect(await pickBackdrop(w2.id, saved.id)).toEqual({ ok: false, reason: '这张背景图已经从模板库删除，不能再选' });
    expect(await pickBackdrop(w2.id, 'builtin:nope@1')).toEqual({ ok: false, reason: '找不到这张背景图' });
  });

  it('合成生成中、背景生成中都不能换背景（和画布上锁住的按钮一致）', async () => {
    const w = await seed();
    await putTask(task(w.id, 1, 0, 'running'));
    expect(await pickBackdrop(w.id, 'builtin:moss@1')).toEqual({ ok: false, reason: '正在合成这一轮候选，等结束后再换背景' });
    const w2 = await seed();
    await putTask(task(w2.id, 1, 0, 'running', 1, 'backdrop'));
    expect(await pickBackdrop(w2.id, 'builtin:moss@1')).toEqual({ ok: false, reason: '背景正在生成中，等两张背景出来后再换' });
  });

  it('做法跟着背景图的来源走（评审第 1 条）：沉淀后重选自家候选仍是「自己生成」；「用模板库里的」下点自家沉淀的切回「自己生成」', async () => {
    const w = await seed();
    const a = await store(w.id);
    const b = await store(w.id, { slot: 1 });
    expect(await pickBackdrop(w.id, a.id)).toEqual({ ok: true });
    expect(await saveToLibrary(a.id, '苔绿晨光')).toEqual({ ok: true });
    expect(await pickBackdrop(w.id, b.id)).toEqual({ ok: true });
    expect(await pickBackdrop(w.id, a.id)).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: a.id, backdropMode: 'generate' });
    // 换到「用模板库里的」（清掉已选），再在模板库里点自家沉淀的那张
    await saveWork(setBackdropMode((await getWork(w.id))!, 'library'));
    expect(await pickBackdrop(w.id, a.id)).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: a.id, backdropMode: 'generate', flow: 'home' });
    // 别的作品沉淀的、内置模板：用模板库里的
    const other = await store('work_other', { savedAt: 1 });
    expect(await pickBackdrop(w.id, other.id)).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: other.id, backdropMode: 'library' });
    expect(await pickBackdrop(w.id, 'builtin:stone@1')).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: 'builtin:stone@1', backdropMode: 'library' });
  });

  it('自家候选沉淀后又从模板库删除，本作品照常能重选；别的作品不能（评审第 10 条）', async () => {
    const w = await seed();
    const a = await store(w.id);
    const b = await store(w.id, { slot: 1 });
    await saveToLibrary(a.id, '苔绿晨光');
    await deleteFromLibrary(a.id);
    expect(await pickBackdrop(w.id, b.id)).toEqual({ ok: true });
    expect(await pickBackdrop(w.id, a.id)).toEqual({ ok: true });
    expect(await getWork(w.id)).toMatchObject({ backdropId: a.id, backdropMode: 'generate' });
    const w2 = await seed();
    expect(await pickBackdrop(w2.id, a.id)).toEqual({ ok: false, reason: '这张背景图已经从模板库删除，不能再选' });
  });

  it('沉淀要起名字；沉淀、改名只改对应字段；删除只做标记', async () => {
    const w = await seed();
    const b = await store(w.id);
    expect(await saveToLibrary(b.id, '  ')).toEqual({ ok: false, reason: '背景图要起个名字' });
    expect(await saveToLibrary(b.id, ' 苔绿晨光 ')).toEqual({ ok: true });
    const saved = await getBackdrop(b.id);
    expect(saved).toMatchObject({ name: '苔绿晨光', deletedAt: null, params: b.params });
    expect(saved?.savedAt).toBeGreaterThan(0);
    expect(await renameBackdrop(b.id, '晨光')).toEqual({ ok: true });
    await deleteFromLibrary(b.id);
    expect(await getBackdrop(b.id)).toMatchObject({ name: '晨光', savedAt: saved!.savedAt });
    expect((await getBackdrop(b.id))?.deletedAt).toBeGreaterThan(0);
  });
});
