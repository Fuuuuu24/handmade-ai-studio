import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/domain/util';
import { newWork } from '@/domain/work';
import { backdrop, result, task, viewTask } from '@/test/fixtures';
import { queueHandoff } from '@/domain/work';
import { dbNotice, dismissCleared, useTestDb, YijianDB } from './db';
import {
  addUpload,
  confirmView,
  deleteWork,
  getBackdrop,
  getBlob,
  getWork,
  listAssets,
  listResults,
  listSavedBackdrops,
  loadMessages,
  patchBackdrop,
  patchResult,
  removeAsset,
  replaceAsset,
  saveBackdropResult,
  saveMessages,
  saveResult,
  saveViewResult,
  saveWork,
  setPhotoKind,
  claimHandoffs,
  claimTaskNotices,
  claimVerdicts,
  getWork as readWork,
  putTask,
} from './repo';
import { getSaveStatus, resetSaveStatus } from './save';

const img = (bytes: number, type = 'image/jpeg') => ({
  blob: new Blob([new Uint8Array(bytes)], { type }),
  thumb: new Blob([new Uint8Array(Math.ceil(bytes / 10))], { type }),
  width: 1600,
  height: 1200,
});

const fresh = () => newWork({ imageModel: 'img-a', chatModel: 'chat-a' });

beforeEach(() => {
  useTestDb(newId('test'));
  resetSaveStatus();
});

describe('作品', () => {
  it('写入成功后显示已保存，读出来和存的一样', async () => {
    const a = { ...fresh(), name: 'A', updatedAt: 1 };
    const b = { ...fresh(), name: 'B', updatedAt: 2 };
    await saveWork(a);
    await saveWork(b);
    expect(getSaveStatus().state).toBe('saved');
    expect(await getWork(a.id)).toEqual(a);
  });

  it('删除作品连同素材、图片、结果、对话和没沉淀的背景图一起删；沉淀过的留在模板库，不影响别的作品', async () => {
    const w = fresh();
    const other = fresh();
    await saveWork(w);
    await saveWork(other);
    const asset = await addUpload(w.id, 'front', img(100));
    const keep = await addUpload(other.id, 'front', img(50));
    const t = { ...task(w.id, 1, 0, 'succeeded') };
    const r = { ...result(w.id, 1, 0), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(10)]));
    await saveMessages(w.id, [{ id: 'm1' }]);
    const draft = backdrop(w.id, 1, 0);
    const saved = backdrop(w.id, 1, 1, { savedAt: 5 });
    await saveBackdropResult({ ...task(w.id, 1, 0, 'succeeded', 1, 'backdrop'), id: draft.taskId }, draft, new Blob([new Uint8Array(7)]), new Blob([new Uint8Array(3)]));
    await saveBackdropResult({ ...task(w.id, 1, 1, 'succeeded', 1, 'backdrop'), id: saved.taskId }, saved, new Blob([new Uint8Array(8)]), new Blob([new Uint8Array(3)]));

    await deleteWork(w.id);
    expect(await getWork(w.id)).toBeUndefined();
    expect(await listAssets(w.id)).toEqual([]);
    expect(await getBlob(asset.blobId)).toBeUndefined();
    expect(await getBlob(r.blobId)).toBeUndefined();
    expect(await listResults(w.id)).toEqual([]);
    expect(await loadMessages(w.id)).toEqual([]);
    expect(await getBackdrop(draft.id)).toBeUndefined();
    expect(await getBlob(draft.blobId)).toBeUndefined();
    expect((await getBackdrop(saved.id))?.savedAt).toBe(5);
    expect((await getBlob(saved.blobId))?.size).toBe(8);
    expect((await getBlob(keep.blobId))?.size).toBe(50);
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

  it('替换原图是新增一条同类型的记录，旧记录和图片都还在；移除只做标记', async () => {
    const w = fresh();
    const old = await addUpload(w.id, 'side', img(1000));
    const next = await replaceAsset(old, img(2000));
    const all = await listAssets(w.id);
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.id === old.id)).toMatchObject({ removed: true, replacedBy: next.id });
    expect((await getBlob(old.blobId))?.size).toBe(1000);
    expect(next).toMatchObject({ kind: 'side', removed: false });
    await removeAsset(next);
    expect((await listAssets(w.id)).find((a) => a.id === next.id)?.removed).toBe(true);
  });

  it('每个角度只放一张：换成已有照片的角度，原来那张退回「未分类」；细节照可以有好几张', async () => {
    const w = fresh();
    const a = await addUpload(w.id, 'front', img(10));
    const b = await addUpload(w.id, 'unsorted', img(10));
    const d1 = await addUpload(w.id, 'detail', img(10));
    await setPhotoKind(b, 'front');
    const kinds = Object.fromEntries((await listAssets(w.id)).map((x) => [x.id, x.kind]));
    expect([kinds[a.id], kinds[b.id], kinds[d1.id]]).toEqual(['unsorted', 'front', 'detail']);
    await setPhotoKind(a, 'detail');
    expect((await listAssets(w.id)).filter((x) => x.kind === 'detail')).toHaveLength(2);
  });
});

describe('三视图', () => {
  it('任务成功派生一张三视图（记角度、来源原图，还没确认）；同一个任务只存一份；确认只改确认标记', async () => {
    const w = fresh();
    const side = await addUpload(w.id, 'side', img(100));
    const t = viewTask(w.id, 'side', side.id, 'succeeded');
    const v = await saveViewResult(t, side, 'side', img(80, 'image/png'));
    expect(v).toMatchObject({ origin: 'view', kind: 'side', view: 'side', parentId: side.id, confirmed: false, taskId: t.id });
    const again = await saveViewResult(t, side, 'side', img(80, 'image/png'));
    expect(again.id).toBe(v.id);
    expect((await listAssets(w.id)).filter((a) => a.origin === 'view')).toHaveLength(1);
    await confirmView(v);
    expect((await listAssets(w.id)).find((a) => a.id === v.id)?.confirmed).toBe(true);
    expect((await getBlob(side.blobId))?.size).toBe(100);
  });
});

describe('背景图与模板库', () => {
  it('同一个任务只存一份；模板库只列沉淀过、没删除的，新沉淀的在前', async () => {
    const w = fresh();
    const a = backdrop(w.id, 1, 0);
    const t = { ...task(w.id, 1, 0, 'succeeded', 1, 'backdrop'), id: a.taskId };
    await saveBackdropResult(t, a, new Blob([new Uint8Array(4)]), new Blob([new Uint8Array(2)]));
    const dup = { ...backdrop(w.id, 1, 0), taskId: a.taskId };
    expect((await saveBackdropResult(t, dup, new Blob([new Uint8Array(4)]), new Blob([new Uint8Array(2)]))).id).toBe(a.id);
    expect(await getBackdrop(dup.id)).toBeUndefined();
    expect(await listSavedBackdrops()).toEqual([]);

    const b = backdrop(w.id, 1, 1);
    await saveBackdropResult({ ...task(w.id, 1, 1, 'succeeded', 1, 'backdrop'), id: b.taskId }, b, new Blob([new Uint8Array(4)]), new Blob([new Uint8Array(2)]));
    await patchBackdrop(a.id, (x) => {
      x.savedAt = 10;
      x.name = '苔绿晨光';
    });
    await patchBackdrop(b.id, (x) => {
      x.savedAt = 20;
    });
    expect((await listSavedBackdrops()).map((x) => x.id)).toEqual([b.id, a.id]);
    await patchBackdrop(b.id, (x) => {
      x.deletedAt = 30;
    });
    expect((await listSavedBackdrops()).map((x) => x.name)).toEqual(['苔绿晨光']);
    expect((await getBackdrop(b.id))?.deletedAt).toBe(30); // 删除只做标记，已经选了它的作品照常能用
  });
});

describe('对话', () => {
  it('整体保存并按顺序取回；不会用更短的旧记录覆盖已保存的对话', async () => {
    const w = fresh();
    await saveWork(w);
    await saveMessages(w.id, [{ id: 'm1' }, { id: 'm2' }]);
    await expect(saveMessages(w.id, [{ id: 'm1' }])).rejects.toThrow('没有覆盖');
    expect(await loadMessages(w.id)).toHaveLength(2);
    await saveMessages(w.id, [{ id: 'm1' }, { id: 'm2b' }, { id: 'm3' }]);
    expect(((await loadMessages(w.id)) as { id: string }[]).map((m) => m.id)).toEqual(['m1', 'm2b', 'm3']);
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

  it('按最新记录修改：连着改两项不会互相覆盖（验收连点、补存说明）', async () => {
    const w = fresh();
    const t = { ...task(w.id, 1, 0, 'succeeded') };
    const r = { ...result(w.id, 1, 0), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(10)]));
    await Promise.all([
      patchResult(r.id, (x) => {
        x.verdict = { ...x.verdict, real: 'ok' };
      }),
      patchResult(r.id, (x) => {
        x.verdict = { ...x.verdict, style: 'ok' };
      }),
    ]);
    expect((await listResults(w.id))[0].verdict).toEqual({ real: 'ok', style: 'ok' });
  });
});

describe('数据库第 2 版（技术写法 13.6）', () => {
  it('从第 1 版升级：清空全部旧数据，删掉布景和我的风格两张表，提示一次「旧的测试作品已清除」', async () => {
    const name = newId('upgrade');
    const old = new Dexie(name);
    old.version(1).stores({ works: 'id, updatedAt', assets: 'id, workId', scenes: 'id, updatedAt', shopStyle: 'id', events: 'id, at, workId' });
    await old.table('works').put({ id: 'work_old', updatedAt: 1 });
    await old.table('scenes').put({ id: 'scene_old', updatedAt: 1 });
    old.close();

    const next = useTestDb(name);
    expect(await next.works.count()).toBe(0);
    expect(next.tables.map((t) => t.name).sort()).toEqual(['approvals', 'assets', 'backdrops', 'blobs', 'events', 'messages', 'results', 'tasks', 'works']);
    expect(dbNotice()).toBe('cleared');
    next.close();
  });

  it('新建的库不跑升级，不提示', async () => {
    dismissCleared();
    expect(dbNotice()).toBeNull();
    const d = new YijianDB(newId('fresh'));
    await d.works.count();
    expect(d.verno).toBe(2);
    expect(dbNotice()).toBeNull();
    d.close();
  });
});

describe('交接与通知的认领（技术写法 13.12）：事务里先写先得', () => {
  it('交接：取走排队的步骤并记下快照；再取就没有了', async () => {
    const w = queueHandoff(queueHandoff(fresh(), 'product'), 'info');
    await saveWork(w);
    const facts = { 品类: { text: '耳饰' } };
    const [a, b] = await Promise.all([claimHandoffs(w.id, facts, 5), claimHandoffs(w.id, facts, 6)]);
    expect([...a, ...b]).toEqual(['product', 'info']);
    expect(await readWork(w.id)).toMatchObject({ pendingHandoffs: [], lastHandoff: { step: 'info', facts } });
    expect(await claimHandoffs(w.id, facts)).toEqual([]);
  });

  it('生成通知：只认领结束了还没通知的；两个标签页同时认领只有一个拿到', async () => {
    const w = fresh();
    const t1 = { ...task(w.id, 1, 0, 'succeeded'), notifiedAt: null };
    const t2 = { ...task(w.id, 1, 1, 'failed'), notifiedAt: 3 };
    const t3 = task(w.id, 1, 0, 'running', 2);
    for (const t of [t1, t2, t3]) await putTask(t);
    const [a, b] = await Promise.all([claimTaskNotices([t1.id, t2.id, t3.id], 9), claimTaskNotices([t1.id, t2.id, t3.id], 9)]);
    expect([...a, ...b]).toEqual([t1.id]);
  });

  it('验收通知：内容变了才认领', async () => {
    const w = fresh();
    const t = task(w.id, 1, 0, 'succeeded');
    const r = { ...result(w.id, 1, 0), taskId: t.id };
    await saveResult(t, r, new Blob([new Uint8Array(3)]));
    expect(await claimVerdicts([{ id: r.id, key: 'ok/ok//' }])).toEqual([r.id]);
    expect(await claimVerdicts([{ id: r.id, key: 'ok/ok//' }])).toEqual([]);
    expect(await claimVerdicts([{ id: r.id, key: 'ok/bad//' }])).toEqual([r.id]);
  });
});
