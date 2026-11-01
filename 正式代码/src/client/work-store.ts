import { maxRefsOf } from '@/config/models';
import { getApproval, getWork, listAssets, listResults, listTasks, saveWork } from '@/data/repo';
import { generating } from '@/domain/generation';
import { makingWhite } from '@/domain/white';
import { basisOf, snapshotOf } from '@/domain/snapshot';
import type { Approval, Asset, Basis, Id, Result, Snapshot, Task, Work } from '@/domain/types';

/* 作品的读取与修改。修改都经 mutateWork 排队执行：小间一次调用多个工具、界面同时编辑时，不会互相覆盖。 */

export interface WorkContext {
  work: Work;
  assets: Asset[];
  approval: Approval | null;
  tasks: Task[];
  results: Result[];
  maxRefs: number;
  basis: Basis;
  snapshot: Snapshot;
  isGenerating: boolean;
  isMakingWhite: boolean; // 白底图任务不锁方案，但做白底时不能删作品
}

export function deriveContext(work: Work, assets: Asset[], approval: Approval | null, tasks: Task[], results: Result[]): WorkContext {
  const maxRefs = maxRefsOf(work.imageModel);
  return {
    work,
    assets,
    approval,
    tasks,
    results,
    maxRefs,
    basis: basisOf(work, assets, maxRefs),
    snapshot: snapshotOf(work, assets, maxRefs),
    isGenerating: generating(tasks, work.id),
    isMakingWhite: makingWhite(tasks, work.id),
  };
}

export async function loadContext(workId: Id): Promise<WorkContext> {
  const work = await getWork(workId);
  if (!work) throw new Error('这件作品不存在或已删除');
  const [assets, tasks, results, approval] = await Promise.all([
    listAssets(workId),
    listTasks(workId),
    listResults(workId),
    getApproval(work.approvalId),
  ]);
  return deriveContext(work, assets, approval ?? null, tasks, results);
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
