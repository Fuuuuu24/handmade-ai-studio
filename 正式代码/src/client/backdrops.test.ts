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

describe('选背景图、沉淀、改名、删除（只由界面按钮调用，PRD 4.2 第 2 条）', () => {
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

  it('合成生成中不能换背景（背景图锁进了合成快照）', async () => {
    const w = await seed();
    await putTask(task(w.id, 1, 0, 'running'));
    expect(await pickBackdrop(w.id, 'builtin:moss@1')).toEqual({ ok: false, reason: '正在合成这一轮候选，等结束后再换背景' });
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
