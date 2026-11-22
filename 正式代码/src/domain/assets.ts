import { ASSET_KINDS } from '@/config/upload';
import { VIEW_ANGLES, VIEW_NAMES, VIEWS, type ViewAngle } from '@/config/views';
import { isActive, type Busy } from './generation';
import type { Asset, AssetKind, Id, Task } from './types';

/* 商品照片与三视图（PRD FR-02、4.3，技术写法 13.3）。原图始终保留；三视图从同角度的原图派生，
   用户对照原图逐张确认，三张都确认商品这一步才完成。合成只用三视图。 */

const KIND_ORDER: Record<AssetKind, number> = { front: 0, side: 1, back: 2, detail: 3, unsorted: 4 };

const byCreated = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt;

// 在用的原图：按正面、侧面、背面、细节、未分类排
export const activeUploads = (assets: readonly Asset[], workId: Id) =>
  assets
    .filter((a) => a.workId === workId && a.origin === 'upload' && !a.removed)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byCreated(a, b));

// 某个角度现在在用的原图。每个角度只放一张：给照片换成已有照片的角度时，原来那张退回「未分类」（data/repo 的 setPhotoKind）
export const angleUpload = (assets: readonly Asset[], workId: Id, angle: ViewAngle) =>
  activeUploads(assets, workId).find((a) => a.kind === angle);

export const missingAngles = (assets: readonly Asset[], workId: Id): ViewAngle[] =>
  VIEW_ANGLES.filter((a) => !angleUpload(assets, workId, a));

export const angleNames = (angles: readonly ViewAngle[]) => angles.map((a) => VIEW_NAMES[a]).join('、');

// 某张原图的三视图任务（按提交顺序）。次数按原图算：换一张原图重新计数
export const viewTasksOf = (tasks: readonly Task[], workId: Id, angle: ViewAngle, sourceId: Id) =>
  tasks
    .filter((t) => t.workId === workId && t.kind === 'view' && t.view === angle && t.sourceAssetIds?.[0] === sourceId)
    .sort(byCreated);

// 某个角度现在的三视图：从这个角度现在的原图生成的、没停用的最新一张。
// 原图换掉、停用或改了类型，旧的三视图自然作废，已有的合成批准随参考图变化失效
export function currentView(assets: readonly Asset[], workId: Id, angle: ViewAngle): Asset | undefined {
  const photo = angleUpload(assets, workId, angle);
  if (!photo) return undefined;
  return assets
    .filter((a) => a.workId === workId && a.origin === 'view' && a.view === angle && a.parentId === photo.id && !a.removed)
    .sort(byCreated)
    .at(-1);
}

export interface AngleState {
  angle: ViewAngle;
  photo: Asset | undefined;
  view: Asset | undefined; // 现在的三视图（可能还没确认）
  generating: boolean;
  failed: string | null; // 最近一次没生成出来（在现在这张三视图之后）
  attempts: number; // 这张原图已经生成过几次（含失败）
}

export function angleState(assets: readonly Asset[], tasks: readonly Task[], workId: Id, angle: ViewAngle): AngleState {
  const photo = angleUpload(assets, workId, angle);
  const view = currentView(assets, workId, angle);
  const list = photo ? viewTasksOf(tasks, workId, angle, photo.id) : [];
  const last = list.at(-1);
  const failed = last?.status === 'failed' && (!view || last.createdAt > view.createdAt) ? (last.error ?? '原因未知') : null;
  return { angle, photo, view, generating: !!last && isActive(last), failed, attempts: list.length };
}

export const angleStates = (assets: readonly Asset[], tasks: readonly Task[], workId: Id) =>
  VIEW_ANGLES.map((a) => angleState(assets, tasks, workId, a));

// 商品这一步完成：三个角度都有已确认的三视图（技术写法 13.2）
export const viewsDone = (assets: readonly Asset[], workId: Id) =>
  VIEW_ANGLES.every((a) => currentView(assets, workId, a)?.confirmed === true);

// 合成用的三视图：已确认的，按正面、侧面、背面
export const viewRefs = (assets: readonly Asset[], workId: Id): Id[] =>
  VIEW_ANGLES.map((a) => currentView(assets, workId, a)).flatMap((v) => (v?.confirmed ? [v.id] : []));

// 「生成三视图」一次做哪些角度：还没有三视图、也没在生成的；已有的要单独「重做」
export const anglesToGenerate = (assets: readonly Asset[], tasks: readonly Task[], workId: Id): ViewAngle[] =>
  angleStates(assets, tasks, workId)
    .filter((s) => s.photo && !s.view && !s.generating)
    .map((s) => s.angle);

// 三视图任务的参考图：这个角度的原图，再加正面原图作整体参考（生成正面时只带一次）
export function viewSources(assets: readonly Asset[], workId: Id, angle: ViewAngle): Id[] | null {
  const photo = angleUpload(assets, workId, angle);
  const front = angleUpload(assets, workId, 'front');
  if (!photo || !front) return null;
  return angle === 'front' ? [photo.id] : [photo.id, front.id];
}

export type ViewCheck = { ok: true } | { ok: false; reason: string };

// 能不能生成这几个角度的三视图：界面按钮、对话里的提议卡片用同一份（PRD AC-02.1、AC-02.3）
export function viewCheck(assets: readonly Asset[], tasks: readonly Task[], workId: Id, angles: readonly ViewAngle[], busy: Busy): ViewCheck {
  const missing = missingAngles(assets, workId);
  if (missing.length) return { ok: false, reason: `还缺${angleNames(missing)}照片，三张都有才能生成三视图` };
  if (!angles.length) return { ok: false, reason: '三个角度都已经有三视图了，不像的可以单独重做那一张' };
  if (busy.scene) return { ok: false, reason: '正在合成这一轮候选，等结束后再做三视图' };
  for (const angle of angles) {
    const s = angleState(assets, tasks, workId, angle);
    if (s.generating) return { ok: false, reason: `${VIEW_NAMES[angle]}的三视图正在生成` };
    if (s.attempts >= VIEWS.perAngle) {
      return { ok: false, reason: `${VIEW_NAMES[angle]}这张照片已经生成过 ${VIEWS.perAngle} 次三视图，换一张更清楚的照片再试` };
    }
  }
  return { ok: true };
}

// 照片和三视图在界面、对话里的叫法
export const assetLabel = (a: Asset) => (a.origin === 'view' && a.view ? `${VIEW_NAMES[a.view]}三视图` : `${ASSET_KINDS[a.kind]}照片`);
