import { VIEW_ANGLES } from '@/config/views';
import { refOfBuiltin } from '@/domain/backdrops';
import { backdropBasisOf, sceneBasisOf, sceneSnapshotOf } from '@/domain/snapshot';
import type { Asset, AssetKind, Backdrop, Id, Result, Task, ViewAngle, Work, WorkState } from '@/domain/types';
import { newId } from '@/domain/util';
import { confirmSummary, draftSummary, newWork, setBackdropMode, setInfo, setStyle, chooseLibraryBackdrop, writePrompt } from '@/domain/work';

export const BUILTIN = 'builtin:moss@1';

export function upload(workId: Id, kind: AssetKind = 'front', extra: Partial<Asset> = {}): Asset {
  return {
    id: newId('asset'),
    workId,
    origin: 'upload',
    kind,
    blobId: newId('blob'),
    thumbId: newId('blob'),
    width: 1600,
    height: 1200,
    mime: 'image/jpeg',
    bytes: 500_000,
    createdAt: Date.now(),
    removed: false,
    ...extra,
  };
}

// 从某张原图派生的三视图（默认已确认）
export function view(parent: Asset, extra: Partial<Asset> = {}): Asset {
  const angle = parent.kind as ViewAngle;
  return { ...upload(parent.workId, angle), origin: 'view', view: angle, parentId: parent.id, confirmed: true, ...extra };
}

// 正面、侧面、背面三张原图，各带一张已确认的三视图
export function product(workId: Id): Asset[] {
  const photos = VIEW_ANGLES.map((k) => upload(workId, k));
  return [...photos, ...photos.map((p) => view(p))];
}

// 规则函数要的整件作品；选定的背景图默认按内置模板解析（用数据库里的背景图时传 backdrop）
export function stateOf(work: Work, assets: readonly Asset[] = [], extra: Partial<WorkState> = {}): WorkState {
  return {
    work,
    assets,
    tasks: [],
    results: [],
    backdrops: [],
    backdrop: work.backdropId ? refOfBuiltin(work.backdropId) : null,
    backdropApproval: null,
    approval: null,
    ...extra,
  };
}

const withInfo = (w: Work) => setInfo(setInfo(setInfo(w, 'category', '耳饰'), 'material', '黄铜镀金'), 'size', '长 4.5cm');

// 除合成提示词外都已就绪：流程一，背景用内置模板，三视图都确认了，摆放和构图选好了
export function readyWork(): { work: Work; assets: Asset[] } {
  let work = withInfo(newWork({ imageModel: 'img-a', chatModel: 'chat-a' }));
  const assets = product(work.id);
  work = chooseLibraryBackdrop(work, BUILTIN);
  work = setStyle(work, 'placement', '平铺', 'user');
  work = setStyle(work, 'composition', '主体居中，留白多', 'user');
  return { work, assets };
}

// 就绪并写好合成提示词
export function promptedWork(): { work: Work; assets: Asset[] } {
  const { work, assets } = readyWork();
  return { work: writePrompt(work, 'scene', '第 1 张是背景图，第 2—4 张是三视图……', sceneBasisOf(work, assets)), assets };
}

// 自己生成背景：信息填好、共创总结已确认、背景风格三项必填选好，还没写背景提示词
export function backdropWork(): Work {
  let work = withInfo(newWork({ imageModel: 'img-a', chatModel: 'chat-a' }));
  work = setBackdropMode(work, 'generate');
  work = confirmSummary(draftSummary(work, { express: '雨后青苔', feel: '安静', avoid: '太花' }));
  work = setStyle(work, 'tone', '雨后苔绿', 'user');
  work = setStyle(work, 'background', '手工纸', 'user');
  work = setStyle(work, 'light', '清冷晨光', 'user');
  return work;
}

export const backdropPromptedWork = () => {
  const work = backdropWork();
  return writePrompt(work, 'backdrop', '一张不含任何饰品和文字的背景图……', backdropBasisOf(work));
};

export const current = (work: Work, assets: readonly Asset[]) => sceneSnapshotOf(work, assets);
export const currentBasis = (work: Work, assets: readonly Asset[]) => sceneBasisOf(work, assets);

export function task(workId: Id, round: number, slot: number, status: Task['status'], attempt = 1, kind: 'backdrop' | 'scene' = 'scene'): Task {
  return {
    id: newId('task'),
    workId,
    kind,
    approvalId: 'apv',
    round,
    slot,
    attempt,
    model: 'img-a',
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function viewTask(workId: Id, angle: ViewAngle, sourceId: Id, status: Task['status'], extra: Partial<Task> = {}): Task {
  return {
    id: newId('task'),
    workId,
    kind: 'view',
    view: angle,
    sourceAssetIds: [sourceId],
    attempt: 1,
    model: 'img-a',
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

export function result(workId: Id, round: number, slot: number, verdict: Result['verdict'] = { real: 'none', style: 'none' }): Result {
  return {
    id: newId('res'),
    workId,
    taskId: newId('task'),
    approvalId: 'apv',
    round,
    slot,
    blobId: newId('blob'),
    width: 1024,
    height: 1024,
    verdict,
    issues: [],
    note: '',
    createdAt: Date.now(),
    exports: [],
  };
}

export function backdrop(workId: Id, round: number, slot: number, extra: Partial<Backdrop> = {}): Backdrop {
  return {
    id: newId('bd'),
    name: `第 ${round} 轮背景 ${slot + 1}`,
    blobId: newId('blob'),
    thumbId: newId('blob'),
    width: 960,
    height: 1280,
    ratio: '3:4',
    params: { tone: '雨后苔绿', background: '手工纸', light: '清冷晨光', props: '', bannedBackdrop: '' },
    prompt: '一张不含任何饰品的背景图',
    imageModel: 'img-a',
    workId,
    taskId: newId('task'),
    round,
    slot,
    savedAt: null,
    createdAt: Date.now(),
    deletedAt: null,
    ...extra,
  };
}
