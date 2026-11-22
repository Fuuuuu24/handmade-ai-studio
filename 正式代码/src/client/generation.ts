import { BACKDROP } from '@/config/backdrops';
import { GENERATION } from '@/config/budget';
import type { Ratio } from '@/config/ratios';
import { VIEWS, type ViewAngle } from '@/config/views';
import {
  activeTasks,
  getAsset,
  getBackdropApproval,
  getBlob,
  getSceneApproval,
  getWork,
  logEvent,
  putTask,
  saveApproval,
  saveBackdropResult,
  saveResult,
  saveViewResult,
} from '@/data/repo';
import { backdropApprovalStatus, sceneApprovalStatus } from '@/domain/approval';
import { anglesToGenerate, viewCheck, viewSources, viewTasksOf } from '@/domain/assets';
import { retryCheck, slotsOf } from '@/domain/generation';
import type { Approval, Backdrop, BackdropApproval, Id, Result, SceneApproval, Task, TaskKind } from '@/domain/types';
import { newId } from '@/domain/util';
import { addCost, approveBackdrop, approveScene, startBackdropRound, startSceneRound } from '@/domain/work';
import { ApiCallError, downloadImageResult, errorText, getImageTaskStatus, submitImageTask } from './api';
import { backdropImage } from './backdrops';
import { prepareDerived, referenceDataUrl } from './images';
import { loadContext, mutateWork, resolveBackdrop, serial } from './work-store';

/* 三种生成（PRD 5.2、FR-08）：三视图由用户点按钮生成；背景图和合成都要有效批准，批准只来自界面上的用户操作。
   每张是独立任务，一张失败不影响另一张。状态如实反映网关返回的结果；刷新页面后继续查询，不自动重新提交（PRD 7.3）。 */

export type GenOutcome = { ok: true; round: number } | { ok: false; reasons: string[] };

const polling = new Set<Id>();
const submitting = new Set<Id>(); // 正在提交的任务，恢复时不能误判为「没来得及提交」
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

function roundTask(workId: Id, kind: 'backdrop' | 'scene', approval: Approval, round: number, slot: number, attempt: number): Task {
  return {
    id: newId('task'),
    workId,
    kind,
    approvalId: approval.id,
    round,
    slot,
    attempt,
    parentResultId: approval.kind === 'scene' ? (approval.parentResultId ?? undefined) : undefined,
    model: approval.snapshot.imageModel,
    status: 'queued',
    createdAt: now(),
    updatedAt: now(),
  };
}

// 提交给网关的内容：类型（假网关按类型出测试图）、提示词、比例、参考图
interface ImageRequest {
  kind: TaskKind;
  prompt: string;
  ratio: Ratio;
  images: () => Promise<string[]>;
}

async function referenceImages(ids: readonly Id[], missing: string): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const asset = await getAsset(id);
    const blob = asset && (await getBlob(asset.blobId));
    if (!blob) throw new Error(missing);
    out.push(await referenceDataUrl(blob));
  }
  return out;
}

/* ---------- 三视图（技术写法 13.3） ---------- */

export type ViewsOutcome = { ok: true; angles: ViewAngle[] } | { ok: false; reason: string };

// 生成三视图：只由用户点按钮调用（对话里的提议卡片也是用户点）。不指定角度时做还没有三视图的那几个；
// 每个角度一个任务，参考图是这个角度的原图，再加正面原图作整体参考
export function generateViews(workId: Id, angles?: readonly ViewAngle[]): Promise<ViewsOutcome> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const list = angles ? [...angles] : anglesToGenerate(ctx.assets, ctx.tasks, workId);
    const check = viewCheck(ctx.assets, ctx.tasks, workId, list, ctx.busy);
    if (!check.ok) return check;
    const keep = ctx.work.info.keep.value.trim();
    for (const angle of list) {
      const sources = viewSources(ctx.assets, workId, angle)!;
      const task: Task = {
        id: newId('task'),
        workId,
        kind: 'view',
        view: angle,
        sourceAssetIds: sources,
        attempt: viewTasksOf(ctx.tasks, workId, angle, sources[0]).length + 1,
        model: ctx.work.imageModel,
        status: 'queued',
        createdAt: now(),
        updatedAt: now(),
      };
      await putTask(task);
      void submit(task, {
        kind: 'view',
        prompt: VIEWS.prompt(angle, keep, sources.length > 1),
        ratio: VIEWS.ratio,
        images: () => referenceImages(sources, '生成三视图用的原图找不到了'),
      });
    }
    void logEvent('views', workId, { angles: list.length, model: ctx.work.imageModel });
    return { ok: true, angles: list };
  });
}

/* ---------- 背景图（技术写法 13.4） ---------- */

const backdropRequest = (approval: BackdropApproval): ImageRequest => ({
  kind: 'backdrop',
  prompt: approval.snapshot.prompt,
  ratio: BACKDROP.ratio,
  images: async () => [],
});

// 用户滑动「批准并生成两张背景」：批准和发起生成是同一个明确操作（AC-07.5）
export function approveAndGenerateBackdrop(workId: Id): Promise<GenOutcome> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const a = approveBackdrop(ctx);
    if (!a.ok) return { ok: false, reasons: a.blockers.map((b) => b.text) };
    await saveApproval(a.work, a.approval);
    void logEvent('approve_backdrop', workId, { version: a.approval.version });
    return launchBackdrop(workId, a.approval);
  });
}

// 小间的 start_backdrop_generation：只在已有有效且未用过的背景批准时执行
export function startBackdropGeneration(workId: Id): Promise<GenOutcome> {
  return serial(workId, () => launchBackdrop(workId, null));
}

async function launchBackdrop(workId: Id, fresh: BackdropApproval | null): Promise<GenOutcome> {
  const ctx = await loadContext(workId);
  const s = startBackdropRound(ctx, fresh ?? ctx.backdropApproval);
  if (!s.ok) return s;
  const tasks = slotsOf('backdrop').map((slot) => roundTask(workId, 'backdrop', s.approval, s.round, slot, 1));
  await saveApproval(s.work, s.approval);
  for (const t of tasks) await putTask(t);
  void logEvent('generate_backdrop', workId, { round: s.round, model: s.approval.snapshot.imageModel });
  for (const t of tasks) void submit(t, backdropRequest(s.approval));
  return { ok: true, round: s.round };
}

/* ---------- 合成（技术写法 13.5） ---------- */

// 合成参考图固定为 1 张背景图＋3 张三视图（AC-02.3a）；原图和细节照不进合成。各张图的用途由小间写进提示词
async function backdropReference(id: Id | null): Promise<string> {
  const ref = await resolveBackdrop(id);
  if (!ref) throw new Error('批准时选的背景图找不到了，请回背景这一步重新选一张');
  return referenceDataUrl(await backdropImage(ref));
}

const sceneRequest = (approval: SceneApproval): ImageRequest => ({
  kind: 'scene',
  prompt: approval.snapshot.prompt,
  ratio: approval.snapshot.ratio,
  images: async () => [
    await backdropReference(approval.snapshot.backdropId),
    ...(await referenceImages(approval.snapshot.references, '批准时用的三视图找不到了，请回商品这一步确认后再批准')),
  ],
});

// 用户滑动「批准并生成两张」：批准和发起生成是同一个明确操作（AC-07.5）
export function approveAndGenerate(workId: Id): Promise<GenOutcome> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const a = approveScene(ctx);
    if (!a.ok) return { ok: false, reasons: a.blockers.map((b) => b.text) };
    await saveApproval(a.work, a.approval);
    void logEvent('approve', workId, { version: a.approval.version });
    return launchScene(workId, a.approval);
  });
}

// 小间的 start_generation：只在已有有效且未用过的合成批准时执行
export function startGeneration(workId: Id): Promise<GenOutcome> {
  return serial(workId, () => launchScene(workId, null));
}

async function launchScene(workId: Id, fresh: SceneApproval | null): Promise<GenOutcome> {
  const ctx = await loadContext(workId);
  const s = startSceneRound(ctx, fresh ?? ctx.approval);
  if (!s.ok) return s;
  const tasks = slotsOf('scene').map((slot) => roundTask(workId, 'scene', s.approval, s.round, slot, 1));
  await saveApproval(s.work, s.approval);
  for (const t of tasks) await putTask(t);
  const snap = s.approval.snapshot;
  void logEvent('generate', workId, { round: s.round, model: snap.imageModel, ratio: snap.ratio });
  for (const t of tasks) void submit(t, sceneRequest(s.approval));
  return { ok: true, round: s.round };
}

/* ---------- 补齐 ---------- */

// 补齐失败的一张（背景或合成）：沿用那一轮的批准，但批准必须仍然有效（PRD 4.2 第 1 条），次数受上限约束
export function retrySlot(workId: Id, kind: 'backdrop' | 'scene', round: number, slot: number): Promise<GenOutcome> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const check = retryCheck(ctx.tasks, workId, kind, round, slot);
    if (!check.ok) return { ok: false, reasons: [check.reason] };
    const prev = ctx.tasks.find((t) => t.kind === kind && t.round === round && t.slot === slot);
    if (kind === 'backdrop') {
      const approval = await getBackdropApproval(prev?.approvalId);
      if (!approval || approval.usedRound !== round) return { ok: false, reasons: ['找不到这一轮背景的批准记录'] };
      if (backdropApprovalStatus(ctx, approval).kind !== 'valid') return { ok: false, reasons: ['批准后背景方案改过了，补齐需要重新批准'] };
      const task = roundTask(workId, 'backdrop', approval, round, slot, check.attempt);
      await putTask(task);
      void logEvent('retry', workId, { kind, round, slot, attempt: check.attempt });
      void submit(task, backdropRequest(approval));
      return { ok: true, round };
    }
    const approval = await getSceneApproval(prev?.approvalId);
    if (!approval || approval.usedRound !== round) return { ok: false, reasons: ['找不到这一轮的批准记录'] };
    if (sceneApprovalStatus(ctx, approval).kind !== 'valid') return { ok: false, reasons: ['批准后方案改过了，补齐需要重新批准'] };
    const task = roundTask(workId, 'scene', approval, round, slot, check.attempt);
    await putTask(task);
    void logEvent('retry', workId, { kind, round, slot, attempt: check.attempt });
    void submit(task, sceneRequest(approval));
    return { ok: true, round };
  });
}

/* ---------- 提交、查询、取回 ---------- */

// 作品已被删除时不再写回任务和结果，免得留下没有作品的记录
const workGone = async (workId: Id) => !(await getWork(workId));

const FAILED_EVENT: Record<TaskKind, string> = { view: 'view_failed', backdrop: 'backdrop_failed', scene: 'task_failed' };

async function fail(task: Task, error: string) {
  if (await workGone(task.workId)) return;
  // 结束了就等着告诉小间（技术写法 13.12）
  await putTask({ ...task, status: 'failed', error, notifiedAt: null, updatedAt: now() });
  void logEvent(FAILED_EVENT[task.kind], task.workId, { round: task.round ?? null, slot: task.slot ?? null, view: task.view ?? null, error: error.slice(0, 80) });
}

async function submit(task: Task, req: ImageRequest) {
  submitting.add(task.id);
  try {
    const images = await req.images();
    const res = await submitImageTask({ kind: req.kind, model: task.model, prompt: req.prompt, ratio: req.ratio, images });
    const running: Task = { ...task, status: 'running', gatewayId: res.gatewayId, ledgerId: res.ledgerId, costUSD: res.estUSD, updatedAt: now() };
    await putTask(running);
    await mutateWork(task.workId, (ctx) => addCost(ctx.work, res.estUSD));
    poll(running);
  } catch (e) {
    await fail(task, errorText(e));
  } finally {
    submitting.delete(task.id);
  }
}

function poll(task: Task) {
  if (!task.gatewayId || polling.has(task.id)) return;
  polling.add(task.id);
  void (async () => {
    let errors = 0;
    try {
      for (;;) {
        if (now() - task.createdAt > GENERATION.timeoutMs) {
          await fail(task, `等了 ${GENERATION.timeoutMs / 60000} 分钟还没有结果，可以${task.kind === 'view' ? '重做' : '补齐'}这一张`);
          return;
        }
        await sleep(GENERATION.pollMs);
        let st;
        try {
          st = await getImageTaskStatus(task.gatewayId!, task.ledgerId);
          errors = 0;
        } catch (e) {
          if (isTransient(e) && ++errors < GENERATION.maxPollErrors) continue;
          throw e;
        }
        if (st.status === 'completed') {
          await collectWithRetry(task);
          return;
        }
        if (st.status === 'failed' || st.status === 'cancelled') {
          if (st.error?.code === 'output_blocked' && task.costUSD) {
            await mutateWork(task.workId, (ctx) => addCost(ctx.work, -task.costUSD!)); // 网关说明这种情况不收费，服务端已退回
            task = { ...task, costUSD: 0 };
          }
          await fail(task, st.error?.message ?? '生成失败');
          return;
        }
      }
    } catch (e) {
      await fail(task, e instanceof DownloadError ? e.message : `查询生成结果失败：${errorText(e)}`);
    } finally {
      polling.delete(task.id);
    }
  })();
}

const isTransient = (e: unknown) => e instanceof ApiCallError && (e.code === 'network' || (e.status ?? 0) >= 500);

class DownloadError extends Error {}

// 图片已经生成（已扣费），取回时遇到临时错误（断网、网关 5xx）就再试几次，免得让商家花钱补齐；仍然失败时如实说明
async function collectWithRetry(task: Task) {
  for (let attempt = 1; ; attempt++) {
    try {
      await collect(task);
      return;
    } catch (e) {
      if (!isTransient(e) || attempt >= GENERATION.downloadTries) {
        throw new DownloadError(`生成好了，但取回或保存图片失败：${errorText(e)}（网关只保留 1 小时，可以${task.kind === 'view' ? '重做' : '补齐'}这一张）`);
      }
      await sleep(GENERATION.pollMs);
    }
  }
}

// 结果立刻存进本地数据库：网关只保留 1 小时，下载次数也有限
async function collect(task: Task) {
  if (await workGone(task.workId)) return;
  const blob = await downloadImageResult(task.gatewayId!, 0);
  const done: Task = { ...task, status: 'succeeded', notifiedAt: null, updatedAt: now() };
  if (task.kind === 'view') return collectView(done, blob);
  if (task.kind === 'backdrop') return collectBackdrop(done, blob);
  const { thumb, width, height } = await prepareDerived(blob);
  const result: Result = {
    id: newId('res'),
    workId: task.workId,
    taskId: task.id,
    approvalId: task.approvalId!,
    round: task.round!,
    slot: task.slot!,
    blobId: newId('blob'),
    thumbId: newId('blob'),
    width,
    height,
    verdict: { real: 'none', style: 'none' },
    issues: [],
    note: '',
    parentId: task.parentResultId,
    createdAt: now(),
    exports: [],
  };
  await saveResult(done, result, blob, thumb);
  void logEvent('task_succeeded', task.workId, { round: task.round ?? null, slot: task.slot ?? null });
}

async function collectView(task: Task, blob: Blob) {
  const parent = await getAsset(task.sourceAssetIds?.[0] ?? '');
  if (!parent) throw new Error('生成三视图用的原图找不到了');
  await saveViewResult(task, parent, task.view!, await prepareDerived(blob));
  void logEvent('view_succeeded', task.workId, { view: task.view ?? null });
}

async function collectBackdrop(task: Task, blob: Blob) {
  const approval = await getBackdropApproval(task.approvalId);
  if (!approval) throw new Error('找不到这一轮背景的批准记录');
  const img = await prepareDerived(blob);
  const backdrop: Backdrop = {
    id: newId('bd'),
    name: `第 ${task.round} 轮背景 ${task.slot! + 1}`,
    blobId: newId('blob'),
    thumbId: newId('blob'),
    width: img.width,
    height: img.height,
    ratio: BACKDROP.ratio,
    params: approval.snapshot.style,
    prompt: approval.snapshot.prompt,
    imageModel: task.model,
    workId: task.workId,
    taskId: task.id,
    round: task.round!,
    slot: task.slot!,
    savedAt: null,
    createdAt: now(),
    deletedAt: null,
  };
  await saveBackdropResult(task, backdrop, img.blob, img.thumb);
  void logEvent('backdrop_succeeded', task.workId, { round: task.round ?? null, slot: task.slot ?? null });
}

// 打开页面时接着查询还没结束的任务；没来得及提交的标为失败，由用户决定是否补齐，不自动重新提交
let resumed = false;
export async function resumeActiveTasks() {
  if (resumed) return;
  resumed = true;
  for (const t of await activeTasks()) {
    if (t.gatewayId) poll(t);
    else if (!submitting.has(t.id)) await fail(t, `页面关闭时这张还没提交（没有扣费），可以${t.kind === 'view' ? '重做' : '补齐'}`);
  }
}
