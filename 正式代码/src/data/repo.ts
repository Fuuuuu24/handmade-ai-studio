import type {
  Approval,
  Asset,
  AssetKind,
  Id,
  Result,
  Scene,
  ShopStyle,
  StoredMessage,
  Task,
  TrialEvent,
  Work,
} from '@/domain/types';
import { newId } from '@/domain/util';
import { db } from './db';
import { tracked } from './save';

/* 读写本地数据库。规则判断在 domain/，这里只负责存取；所有写入都经 tracked() 汇报保存状态。 */

/* ---------- 作品 ---------- */

export const listWorks = () => db().works.orderBy('updatedAt').reverse().toArray();
export const getWork = (id: Id) => db().works.get(id);
export const saveWork = (work: Work) => tracked(`work:${work.id}`, () => db().works.put(work));

// 批准和作品一起写，避免只存了一半
export const saveApproval = (work: Work, approval: Approval) =>
  tracked(`work:${work.id}`, () =>
    db().transaction('rw', [db().works, db().approvals], async () => {
      await db().approvals.put(approval);
      await db().works.put(work);
    }),
  );

export const getApproval = (id: Id | null) => (id ? db().approvals.get(id) : Promise.resolve(undefined));
export const listApprovals = (workId: Id) => db().approvals.where('workId').equals(workId).toArray();

// 删除作品：用户确认后才调用（PRD 4.2 第 5 条），连同素材、图片、对话、任务和结果一起删
export function deleteWork(id: Id) {
  const d = db();
  return tracked(`work:${id}`, () =>
    d.transaction('rw', [d.works, d.assets, d.blobs, d.messages, d.tasks, d.results, d.approvals, d.events], async () => {
      const assets = await d.assets.where('workId').equals(id).toArray();
      const results = await d.results.where('workId').equals(id).toArray();
      const blobIds = [...assets.flatMap((a) => [a.blobId, a.thumbId]), ...results.map((r) => r.blobId)];
      await d.blobs.bulkDelete(blobIds);
      await d.assets.where('workId').equals(id).delete();
      await d.results.where('workId').equals(id).delete();
      await d.messages.where('workId').equals(id).delete();
      await d.tasks.where('workId').equals(id).delete();
      await d.approvals.where('workId').equals(id).delete();
      await d.events.where('workId').equals(id).delete();
      await d.works.delete(id);
    }),
  );
}

/* ---------- 素材与图片 ---------- */

export interface ImageInput {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

export const getBlob = async (id: Id) => (await db().blobs.get(id))?.data;
export const listAssets = (workId: Id) => db().assets.where('workId').equals(workId).toArray();
export const getAsset = (id: Id) => db().assets.get(id);

function assetRecord(workId: Id, img: ImageInput, extra: Pick<Asset, 'origin' | 'kind'> & Partial<Asset>): Asset {
  return {
    id: newId('asset'),
    workId,
    blobId: newId('blob'),
    thumbId: newId('blob'),
    width: img.width,
    height: img.height,
    mime: img.blob.type,
    bytes: img.blob.size,
    createdAt: Date.now(),
    removed: false,
    ...extra,
  };
}

async function putAsset(asset: Asset, img: ImageInput) {
  const d = db();
  await d.transaction('rw', [d.assets, d.blobs], async () => {
    await d.blobs.bulkPut([
      { id: asset.blobId, data: img.blob },
      { id: asset.thumbId, data: img.thumb },
    ]);
    await d.assets.put(asset);
  });
  return asset;
}

export const addUpload = (workId: Id, kind: AssetKind, img: ImageInput) =>
  tracked(`assets:${workId}`, () => putAsset(assetRecord(workId, img, { origin: 'upload', kind }), img));

export const addWhite = (workId: Id, parent: Asset, method: NonNullable<Asset['method']>, img: ImageInput) =>
  tracked(`assets:${workId}`, () =>
    putAsset(assetRecord(workId, img, { origin: 'white', kind: parent.kind, parentId: parent.id, method }), img),
  );

export const setAssetKind = (asset: Asset, kind: AssetKind) =>
  tracked(`assets:${asset.workId}`, () => db().assets.update(asset.id, { kind }));

// 移除只是不再使用，原图记录和图片都保留（PRD 4.2 第 5 条）
export const removeAsset = (asset: Asset) =>
  tracked(`assets:${asset.workId}`, () => db().assets.update(asset.id, { removed: true }));

// 替换原图：新增一条记录，旧记录标记为被替换，不覆盖
export function replaceAsset(old: Asset, img: ImageInput) {
  const d = db();
  return tracked(`assets:${old.workId}`, async () => {
    const next = assetRecord(old.workId, img, { origin: 'upload', kind: old.kind });
    await d.transaction('rw', [d.assets, d.blobs], async () => {
      await putAsset(next, img);
      await d.assets.update(old.id, { removed: true, replacedBy: next.id });
    });
    return next;
  });
}

/* ---------- 生成任务与结果 ---------- */

export const putTask = (task: Task) => tracked(`task:${task.id}`, () => db().tasks.put(task));
export const listTasks = (workId: Id) => db().tasks.where('workId').equals(workId).toArray();
export const activeTasks = () => db().tasks.where('status').anyOf('queued', 'running').toArray();

// 任务成功：图片、结果和任务状态一起写
export function saveResult(task: Task, result: Result, image: Blob) {
  const d = db();
  return tracked(`task:${task.id}`, () =>
    d.transaction('rw', [d.tasks, d.results, d.blobs], async () => {
      await d.blobs.put({ id: result.blobId, data: image });
      await d.results.put(result);
      await d.tasks.put(task);
    }),
  );
}

export const updateResult = (result: Result) => tracked(`result:${result.id}`, () => db().results.put(result));
export const listResults = (workId: Id) => db().results.where('workId').equals(workId).toArray();
export const allResults = () => db().results.orderBy('createdAt').reverse().toArray();

/* ---------- 对话 ---------- */

// 每次整体写入这件作品的对话，保持顺序
export function saveMessages(workId: Id, messages: { id: string }[]) {
  const d = db();
  return tracked(`messages:${workId}`, () =>
    d.transaction('rw', d.messages, async () => {
      await d.messages.where('workId').equals(workId).delete();
      const at = Date.now();
      await d.messages.bulkPut(
        messages.map((m, seq): StoredMessage => ({ id: `${workId}:${m.id}`, workId, seq, message: m, createdAt: at })),
      );
    }),
  );
}

export async function loadMessages(workId: Id): Promise<unknown[]> {
  const rows = await db().messages.where('[workId+seq]').between([workId, -Infinity], [workId, Infinity]).toArray();
  return rows.map((r) => r.message);
}

/* ---------- 布景与我的风格 ---------- */

export const listScenes = () => db().scenes.orderBy('updatedAt').reverse().toArray();
export const getScene = (id: Id) => db().scenes.get(id);
export const saveScene = (scene: Scene) => tracked(`scene:${scene.id}`, () => db().scenes.put(scene));
export const deleteScene = (id: Id) => tracked(`scene:${id}`, () => db().scenes.delete(id));

export const getShopStyle = async (): Promise<ShopStyle> =>
  (await db().shopStyle.get('me')) ?? { id: 'me', prefs: {}, history: [] };
export const saveShopStyle = (s: ShopStyle) => tracked('shop-style', () => db().shopStyle.put(s));

/* ---------- 试用记录 ---------- */

// 事件日志写失败不打断主流程，但要留下记录：控制台报错，并计数，导出试用记录时写明漏记了几条
let failedEvents = 0;
export const failedEventCount = () => failedEvents;

export async function logEvent(type: string, workId?: Id, data?: TrialEvent['data']) {
  try {
    await db().events.put({ id: newId('evt'), at: Date.now(), type, workId, data });
  } catch (e) {
    failedEvents += 1;
    console.error('试用事件没记上', type, e);
  }
}

export const listEvents = () => db().events.orderBy('at').toArray();
