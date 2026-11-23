import type { StepId } from '@/config/steps';
import { isViewAngle, type ViewAngle } from '@/config/views';
import type { Approval, Asset, AssetKind, Backdrop, BackdropApproval, Fact, Id, Result, SceneApproval, StoredMessage, Task, TrialEvent, Work } from '@/domain/types';
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

export const getApproval = (id: Id | null | undefined) => (id ? db().approvals.get(id) : Promise.resolve(undefined));

export async function getBackdropApproval(id: Id | null | undefined): Promise<BackdropApproval | undefined> {
  const a = await getApproval(id);
  return a?.kind === 'backdrop' ? a : undefined;
}

export async function getSceneApproval(id: Id | null | undefined): Promise<SceneApproval | undefined> {
  const a = await getApproval(id);
  return a?.kind === 'scene' ? a : undefined;
}

export const listApprovals = (workId: Id) => db().approvals.where('workId').equals(workId).toArray();

// 删除作品：用户确认后才调用（PRD 4.2 第 5 条），连同素材、图片、对话、任务和结果一起删。
// 这件作品生成、没沉淀的背景图一起删；已沉淀的留在模板库，别的作品可能在用（技术写法 13.6）
export function deleteWork(id: Id) {
  const d = db();
  return tracked(`work:${id}`, () =>
    d.transaction('rw', [d.works, d.assets, d.blobs, d.messages, d.tasks, d.results, d.approvals, d.backdrops, d.events], async () => {
      const assets = await d.assets.where('workId').equals(id).toArray();
      const results = await d.results.where('workId').equals(id).toArray();
      const backdrops = (await d.backdrops.where('workId').equals(id).toArray()).filter((b) => b.savedAt == null);
      const blobIds = [
        ...assets.flatMap((a) => [a.blobId, a.thumbId]),
        ...results.flatMap((r) => (r.thumbId ? [r.blobId, r.thumbId] : [r.blobId])),
        ...backdrops.flatMap((b) => [b.blobId, b.thumbId]),
      ];
      await d.blobs.bulkDelete(blobIds);
      await d.backdrops.bulkDelete(backdrops.map((b) => b.id));
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

// 改照片类型：每个角度只放一张，新放进来的顶替原来那张，原来那张退回「未分类」（技术写法 13.3）
export function setPhotoKind(asset: Asset, kind: AssetKind) {
  const d = db();
  return tracked(`assets:${asset.workId}`, () =>
    d.transaction('rw', d.assets, async () => {
      if (isViewAngle(kind)) {
        await d.assets
          .where('workId')
          .equals(asset.workId)
          .filter((a) => a.origin === 'upload' && !a.removed && a.kind === kind && a.id !== asset.id)
          .modify({ kind: 'unsorted' });
      }
      await d.assets.update(asset.id, { kind });
    }),
  );
}

// 移除只是不再使用，原图记录和图片都保留（PRD 4.2 第 5 条）
export const removeAsset = (asset: Asset) =>
  tracked(`assets:${asset.workId}`, () => db().assets.update(asset.id, { removed: true }));

// 替换原图：新增一条记录（同一个类型），旧记录标记为被替换，不覆盖
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

// 三视图逐张确认（AC-02.3）：用户在对照弹窗里点，或问过用户、用户同意后小间代点（技术写法 14.4）；
// 点错了可以在对照弹窗里取消确认（技术写法 14.11 第 4 条），不用花钱重做
export const confirmView = (asset: Asset) => tracked(`assets:${asset.workId}`, () => db().assets.update(asset.id, { confirmed: true }));
export const unconfirmView = (asset: Asset) => tracked(`assets:${asset.workId}`, () => db().assets.update(asset.id, { confirmed: false }));

/* ---------- 生成任务与结果 ---------- */

export const putTask = (task: Task) => tracked(`task:${task.id}`, () => db().tasks.put(task));
export const listTasks = (workId: Id) => db().tasks.where('workId').equals(workId).toArray();
export const activeTasks = () => db().tasks.where('status').anyOf('queued', 'running').toArray();

// 任务成功：图片、结果和任务状态一起写。同一个任务已经存过结果时不再存（两个标签页同时轮询同一件作品）
export function saveResult(task: Task, result: Result, image: Blob, thumb?: Blob) {
  const d = db();
  return tracked(`task:${task.id}`, () =>
    d.transaction('rw', [d.tasks, d.results, d.blobs], async () => {
      const dup = await d.results.where('workId').equals(result.workId).filter((r) => r.taskId === task.id).count();
      if (dup) {
        await d.tasks.put(task);
        return;
      }
      await d.blobs.put({ id: result.blobId, data: image });
      if (result.thumbId && thumb) await d.blobs.put({ id: result.thumbId, data: thumb });
      await d.results.put(result);
      await d.tasks.put(task);
    }),
  );
}

// 三视图任务成功：派生一张三视图素材（记角度和来源原图，还没确认），和任务状态一起写；同一个任务只存一份
export function saveViewResult(task: Task, parent: Asset, angle: ViewAngle, img: ImageInput) {
  const d = db();
  return tracked(`task:${task.id}`, () =>
    d.transaction('rw', [d.tasks, d.assets, d.blobs], async () => {
      const dup = await d.assets.where('workId').equals(task.workId).filter((a) => a.taskId === task.id).first();
      if (dup) {
        await d.tasks.put({ ...task, viewAssetId: dup.id });
        return dup;
      }
      const asset = assetRecord(task.workId, img, { origin: 'view', kind: angle, view: angle, parentId: parent.id, confirmed: false, taskId: task.id });
      await putAsset(asset, img);
      await d.tasks.put({ ...task, viewAssetId: asset.id });
      return asset;
    }),
  );
}

// 按数据库里的最新记录修改一张结果：验收、问题标签、说明、导出记录各改各的字段，连着点也不会互相覆盖
export const patchResult = (id: Id, fn: (r: Result) => void) =>
  tracked(`result:${id}`, () => db().results.where('id').equals(id).modify(fn));
export const getResult = (id: Id) => db().results.get(id);
export const listResults = (workId: Id) => db().results.where('workId').equals(workId).toArray();
export const allResults = () => db().results.orderBy('createdAt').reverse().toArray();

/* ---------- 背景图与模板库 ---------- */

// 背景任务成功：存一张背景图（还没沉淀），和任务状态一起写；同一个任务只存一份
export function saveBackdropResult(task: Task, backdrop: Backdrop, image: Blob, thumb: Blob) {
  const d = db();
  return tracked(`task:${task.id}`, () =>
    d.transaction('rw', [d.tasks, d.backdrops, d.blobs], async () => {
      const dup = await d.backdrops.where('workId').equals(task.workId).filter((b) => b.taskId === task.id).first();
      if (dup) {
        await d.tasks.put({ ...task, backdropId: dup.id });
        return dup;
      }
      await d.blobs.bulkPut([
        { id: backdrop.blobId, data: image },
        { id: backdrop.thumbId, data: thumb },
      ]);
      await d.backdrops.put(backdrop);
      await d.tasks.put({ ...task, backdropId: backdrop.id });
      return backdrop;
    }),
  );
}

export const getBackdrop = (id: Id) => db().backdrops.get(id);
export const listWorkBackdrops = (workId: Id) => db().backdrops.where('workId').equals(workId).toArray();
export const allBackdrops = () => db().backdrops.toArray();

// 模板库里自己沉淀的背景图：沉淀过、没删除的，新沉淀的在前
export async function listSavedBackdrops(): Promise<Backdrop[]> {
  const saved = await db().backdrops.where('savedAt').above(0).toArray();
  return saved.filter((b) => b.deletedAt == null).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

// 沉淀、改名、删除（AC-06.4；谁能点见 client/backdrops.ts）：按数据库里的最新记录只改对应字段
export const patchBackdrop = (id: Id, fn: (b: Backdrop) => void) =>
  tracked(`backdrop:${id}`, () => db().backdrops.where('id').equals(id).modify(fn));

/* ---------- 交接与通知的认领（技术写法 13.12）：事务里先写先得，两个标签页同时开着也只发一次 ---------- */

// 取走排队的「下一步」交接，同时记下交接时的作品快照（之后的变化写进作品状态）。调用方要包在 serial 里，免得被整条作品覆盖
export function claimHandoffs(workId: Id, facts: Record<string, Fact>, at = Date.now()): Promise<StepId[]> {
  const d = db();
  return tracked(`work:${workId}`, () =>
    d.transaction('rw', d.works, async () => {
      const w = await d.works.get(workId);
      const steps = w?.pendingHandoffs ?? [];
      if (!w || !steps.length) return [];
      await d.works.update(workId, { pendingHandoffs: [], lastHandoff: { step: steps.at(-1)!, at, facts } });
      return steps;
    }),
  );
}

// 生成通知：只认领结束了、还没通知的任务
export function claimTaskNotices(ids: readonly Id[], at = Date.now()): Promise<Id[]> {
  const d = db();
  return d.transaction('rw', d.tasks, async () => {
    const got: Id[] = [];
    for (const t of await d.tasks.bulkGet([...ids])) {
      if (t && t.notifiedAt === null) {
        await d.tasks.update(t.id, { notifiedAt: at });
        got.push(t.id);
      }
    }
    return got;
  });
}

// 验收通知：验收内容和上次通知的不一样才认领（key 由 domain/notices.ts 的 verdictKey 算）
export function claimVerdicts(items: readonly { id: Id; key: string }[]): Promise<Id[]> {
  const d = db();
  return d.transaction('rw', d.results, async () => {
    const got: Id[] = [];
    for (const it of items) {
      const r = await d.results.get(it.id);
      if (r && r.notifiedVerdict !== it.key) {
        await d.results.update(it.id, { notifiedVerdict: it.key });
        got.push(it.id);
      }
    }
    return got;
  });
}

/* ---------- 对话 ---------- */

// 每次整体写入这件作品的对话，保持顺序。对话只会变长（重试只替换最后一条）：内存里的记录比已存的少，
// 说明界面拿的是旧记录（比如开发时热更新重新挂载），拒绝覆盖，避免丢掉已有对话
export function saveMessages(workId: Id, messages: { id: string }[]) {
  const d = db();
  return tracked(`messages:${workId}`, () =>
    d.transaction('rw', d.messages, async () => {
      const stored = await d.messages.where('workId').equals(workId).count();
      if (stored > messages.length) throw new Error(`对话记录比本地已保存的少（${messages.length} < ${stored}），没有覆盖；请刷新页面`);
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
