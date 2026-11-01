import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/domain/util';
import { newWork } from '@/domain/work';
import { result, task } from '@/test/fixtures';
import { useTestDb } from './db';
import {
  addUpload,
  addWhite,
  deleteWork,
  getBlob,
  getWork,
  listAssets,
  listResults,
  listWorks,
  loadMessages,
  patchResult,
  removeAsset,
  replaceAsset,
  saveMessages,
  saveResult,
  saveWork,
} from './repo';
import { getSaveStatus, resetSaveStatus } from './save';

const img = (bytes: number, type = 'image/jpeg') => ({
  blob: new Blob([new Uint8Array(bytes)], { type }),
  thumb: new Blob([new Uint8Array(Math.ceil(bytes / 10))], { type }),
  width: 1600,
  height: 1200,
});

const fresh = () => newWork({ imageModel: 'img-a', chatModel: 'chat-a', route: 'B' });

beforeEach(() => {
  useTestDb(newId('test'));
  resetSaveStatus();
});

describe('作品', () => {
  it('按最近更新排序；写入成功后显示已保存', async () => {
    const a = { ...fresh(), name: 'A', updatedAt: 1 };
    const b = { ...fresh(), name: 'B', updatedAt: 2 };
    await saveWork(a);
    await saveWork(b);
    expect((await listWorks()).map((w) => w.name)).toEqual(['B', 'A']);
    expect(getSaveStatus().state).toBe('saved');
    expect(await getWork(a.id)).toEqual(a);
  });

  it('删除作品连同素材、图片、结果和对话一起删，不影响别的作品', async () => {
    const w = fresh();
    const other = fresh();
    await saveWork(w);
    await saveWork(other);
    const asset = await addUpload(w.id, 'overall', img(100));
    const keep = await addUpload(other.id, 'overall', img(50));
    const t = { ...task(w.id, 1, 0, 'succeeded') };
    const r = { ...result(w.id, 1, 0), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(10)]));
    await saveMessages(w.id, [{ id: 'm1' }]);

    await deleteWork(w.id);
    expect(await getWork(w.id)).toBeUndefined();
    expect(await listAssets(w.id)).toEqual([]);
    expect(await getBlob(asset.blobId)).toBeUndefined();
    expect(await getBlob(r.blobId)).toBeUndefined();
    expect(await listResults(w.id)).toEqual([]);
    expect(await loadMessages(w.id)).toEqual([]);
    expect((await getBlob(keep.blobId))?.size).toBe(50);
  });
});

describe('对话', () => {
  it('不会用更短的旧记录覆盖已保存的对话', async () => {
    const w = fresh();
    await saveWork(w);
    await saveMessages(w.id, [{ id: 'm1' }, { id: 'm2' }]);
    await expect(saveMessages(w.id, [{ id: 'm1' }])).rejects.toThrow('没有覆盖');
    expect(await loadMessages(w.id)).toHaveLength(2);
    await saveMessages(w.id, [{ id: 'm1' }, { id: 'm2b' }, { id: 'm3' }]);
    expect(await loadMessages(w.id)).toHaveLength(3);
  });
});

describe('结果', () => {
  it('同一个任务的结果只存一份（两个标签页同时轮询时）', async () => {
    const w = fresh();
    await saveWork(w);
    const t = { ...task(w.id, 1, 0, 'succeeded') };
    await saveResult(t, { ...result(w.id, 1, 0), taskId: t.id }, new Blob([new Uint8Array(10)]));
    const second = { ...result(w.id, 1, 0), taskId: t.id };
    await saveResult(t, second, new Blob([new Uint8Array(10)]));
    expect(await listResults(w.id)).toHaveLength(1);
    expect(await getBlob(second.blobId)).toBeUndefined();
  });
});

describe('素材：原图始终保留（PRD 4.2 第 5 条）', () => {
  it('上传后原图和缩略图都能取回', async () => {
    const w = fresh();
    const a = await addUpload(w.id, 'detail', img(1000, 'image/png'));
    expect(a).toMatchObject({ origin: 'upload', kind: 'detail', mime: 'image/png', bytes: 1000, removed: false });
    expect((await getBlob(a.blobId))?.size).toBe(1000);
    expect((await getBlob(a.thumbId))?.size).toBe(100);
  });

  it('替换原图是新增一条记录，旧记录和图片都还在', async () => {
    const w = fresh();
    const old = await addUpload(w.id, 'overall', img(1000));
    const next = await replaceAsset(old, img(2000));
    const all = await listAssets(w.id);
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.id === old.id)).toMatchObject({ removed: true, replacedBy: next.id });
    expect((await getBlob(old.blobId))?.size).toBe(1000);
    expect(next).toMatchObject({ kind: 'overall', removed: false });
  });

  it('移除只做标记；白底图记下来源和做法', async () => {
    const w = fresh();
    const a = await addUpload(w.id, 'overall', img(100));
    const wb = await addWhite(w.id, a, 'matting', img(80, 'image/png'));
    await removeAsset(a);
    const all = await listAssets(w.id);
    expect(all.find((x) => x.id === a.id)?.removed).toBe(true);
    expect(all.find((x) => x.id === wb.id)).toMatchObject({ origin: 'white', parentId: a.id, method: 'matting' });
    expect((await getBlob(a.blobId))?.size).toBe(100);
  });
});

describe('对话', () => {
  it('不会用更短的旧记录覆盖已保存的对话', async () => {
    const w = fresh();
    await saveWork(w);
    await saveMessages(w.id, [{ id: 'm1' }, { id: 'm2' }]);
    await expect(saveMessages(w.id, [{ id: 'm1' }])).rejects.toThrow('没有覆盖');
    expect(await loadMessages(w.id)).toHaveLength(2);
    await saveMessages(w.id, [{ id: 'm1' }, { id: 'm2b' }, { id: 'm3' }]);
    expect(await loadMessages(w.id)).toHaveLength(3);
  });
});

describe('结果', () => {
  it('按最新记录修改：连着改两项不会互相覆盖（验收连点、补存说明）', async () => {
    const w = fresh();
    const t = task(w.id, 1, 0, 'succeeded');
    const r = { ...result(w.id, 1, 0), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(10)]));
    // 两次修改都基于同一份旧记录发起，模拟界面还没刷新时连着点
    await Promise.all([
      patchResult(r.id, (x) => {
        x.verdict = { ...x.verdict, real: 'ok' };
      }),
      patchResult(r.id, (x) => {
        x.verdict = { ...x.verdict, style: 'ok' };
      }),
      patchResult(r.id, (x) => {
        x.note = '链子对了';
      }),
    ]);
    expect((await listResults(w.id))[0]).toMatchObject({ verdict: { real: 'ok', style: 'ok' }, note: '链子对了' });
  });
});

describe('对话', () => {
  it('整体保存并按顺序取回，覆盖旧内容', async () => {
    const w = fresh();
    await saveMessages(w.id, [{ id: 'a' }, { id: 'b' }]);
    await saveMessages(w.id, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(await loadMessages(w.id)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });
});
