import { isBuiltinBackdrop } from '@/config/backdrops';
import { maxRefsOf } from '@/config/models';
import { deleteWork, getBackdrop, getBackdropApproval, getSceneApproval, getWork, listAssets, listResults, listTasks, listWorkBackdrops, logEvent, saveWork } from '@/data/repo';
import { refOfBackdrop, refOfBuiltin } from '@/domain/backdrops';
import { anyBusy, busyOf, type Busy } from '@/domain/generation';
import { backdropBasisOf, backdropSnapshotOf, sceneBasisOf, sceneSnapshotOf } from '@/domain/snapshot';
import type { BackdropBasis, BackdropRef, BackdropSnapshot, Id, SceneBasis, SceneSnapshot, Work, WorkState } from '@/domain/types';

/* 作品的读取与修改。修改都经 mutateWork 排队执行：小间一次调用多个工具、界面同时编辑时，不会互相覆盖。 */

export interface WorkContext extends WorkState {
  maxRefs: number;
  busy: Busy; // 三种生成各自是否在进行（技术写法 13.6）
  anyGenerating: boolean; // 任一种生成中：不能删作品，顶栏转圈
  backdropBasis: BackdropBasis;
  backdropSnapshot: BackdropSnapshot;
  basis: SceneBasis; // 合成提示词的依据
  snapshot: SceneSnapshot; // 合成批准的快照
}

export function deriveContext(s: WorkState): WorkContext {
  const busy = busyOf(s.tasks, s.work.id);
  return {
    ...s,
    maxRefs: maxRefsOf(s.work.imageModel),
    busy,
    anyGenerating: anyBusy(busy),
    backdropBasis: backdropBasisOf(s.work),
    backdropSnapshot: backdropSnapshotOf(s.work),
    basis: sceneBasisOf(s.work, s.assets),
    snapshot: sceneSnapshotOf(s.work, s.assets),
  };
}

// 选定的背景图：内置模板从配置里取，其余从数据库取；找不到时为空（规则层会写明「找不到了」）
export async function resolveBackdrop(id: Id | null | undefined): Promise<BackdropRef | null> {
  if (!id) return null;
  if (isBuiltinBackdrop(id)) return refOfBuiltin(id);
  const b = await getBackdrop(id);
  return b ? refOfBackdrop(b) : null;
}

export async function loadState(work: Work): Promise<WorkState> {
  const [assets, tasks, results, backdrops, backdropApproval, approval, backdrop] = await Promise.all([
    listAssets(work.id),
    listTasks(work.id),
    listResults(work.id),
    listWorkBackdrops(work.id),
    getBackdropApproval(work.backdropApprovalId),
    getSceneApproval(work.approvalId),
    resolveBackdrop(work.backdropId),
  ]);
  return { work, assets, tasks, results, backdrops, backdrop, backdropApproval: backdropApproval ?? null, approval: approval ?? null };
}

export async function loadContext(workId: Id): Promise<WorkContext> {
  const work = await getWork(workId);
  if (!work) throw new Error('这件作品不存在或已删除');
  return deriveContext(await loadState(work));
}

const queues = new Map<Id, Promise<unknown>>();

// 同一件作品的操作按顺序执行。fn 里不要再调用 serial／mutateWork，否则会互相等待
export function serial<T>(workId: Id, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(workId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(
    workId,
    run.catch(() => undefined),
  );
  return run;
}

export function mutateWork(workId: Id, fn: (ctx: WorkContext) => Work | Promise<Work>): Promise<Work> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const next = await fn(ctx);
    if (next !== ctx.work) await saveWork(next);
    return next;
  });
}

// 删除作品：用户在确认框里点了「删除」之后（顶栏的删除按钮，或小间发起的 request_delete，PRD 4.2 第 5 条）。
// 试用记录留一条带花费的删除记录，作品删了累计成本也不漏算
export async function removeWork(work: Pick<Work, 'id' | 'costUSD'>): Promise<void> {
  await deleteWork(work.id);
  void logEvent('delete_work', undefined, { costUSD: work.costUSD });
}
