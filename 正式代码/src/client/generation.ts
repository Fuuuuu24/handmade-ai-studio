import { GENERATION } from '@/config/budget';
import { activeTasks, getApproval, getAsset, getBlob, getWork, logEvent, putTask, saveApproval, saveResult } from '@/data/repo';
import { approvalStatus } from '@/domain/approval';
import { retryCheck, roundSlots } from '@/domain/generation';
import type { Approval, Id, Result, Task } from '@/domain/types';
import { newId } from '@/domain/util';
import { addCost, approve, startRound } from '@/domain/work';
import { ApiCallError, downloadImageResult, errorText, getImageTaskStatus, submitImageTask } from './api';
import { imageSize, referenceDataUrl } from './images';
import { loadContext, mutateWork, serial } from './work-store';

/* 生成两张候选（PRD FR-08）。批准只来自界面上的用户操作；每张候选是独立任务，一张失败不影响另一张。
   状态如实反映网关返回的结果；刷新页面后继续查询，不自动重新提交（PRD 7.3）。 */

export type GenOutcome = { ok: true; round: number } | { ok: false; reasons: string[] };

const polling = new Set<Id>();
const submitting = new Set<Id>(); // 正在提交的任务，恢复时不能误判为「没来得及提交」
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

function newTask(workId: Id, approval: Approval, round: number, slot: number, attempt: number): Task {
  return {
    id: newId('task'),
    workId,
    kind: 'scene',
    approvalId: approval.id,
    round,
    slot,
    attempt,
    model: approval.snapshot.imageModel,
    status: 'queued',
    createdAt: now(),
    updatedAt: now(),
  };
}

// 用户点「批准并生成」：批准和发起生成是同一个明确操作（AC-07.5）
export function approveAndGenerate(workId: Id): Promise<GenOutcome> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const a = approve(ctx.work, ctx.assets, ctx.snapshot, ctx.isGenerating);
    if (!a.ok) return { ok: false, reasons: a.blockers.map((b) => b.text) };
    await saveApproval(a.work, a.approval);
    void logEvent('approve', workId, { version: a.approval.version });
    return launch(workId, a.approval);
  });
}

// 小间的 start_generation：只在已有有效且未用过的批准时执行
export function startGeneration(workId: Id): Promise<GenOutcome> {
  return serial(workId, () => launch(workId, null));
}

async function launch(workId: Id, fresh: Approval | null): Promise<GenOutcome> {
  const ctx = await loadContext(workId);
  const approval = fresh ?? ctx.approval;
  const s = startRound(ctx.work, approval, ctx.snapshot, ctx.isGenerating);
  if (!s.ok) return s;
  const tasks = roundSlots().map((slot) => newTask(workId, s.approval, s.round, slot, 1));
  await saveApproval(s.work, s.approval);
  for (const t of tasks) await putTask(t);
  const snap = s.approval.snapshot;
  void logEvent('generate', workId, { round: s.round, model: snap.imageModel, route: snap.route, ratio: snap.ratio });
  for (const t of tasks) void submit(t, s.approval);
  return { ok: true, round: s.round };
}

async function referenceImages(approval: Approval): Promise<string[]> {
  const out: string[] = [];
  for (const id of approval.snapshot.references) {
    const asset = await getAsset(id);
    const blob = asset && (await getBlob(asset.blobId));
    if (!blob) throw new Error('批准时用的参考图找不到了，请重新确认资产后再批准');
    out.push(await referenceDataUrl(blob));
  }
  return out;
}

// 作品已被删除时不再写回任务和结果，免得留下没有作品的记录
const workGone = async (workId: Id) => !(await getWork(workId));

async function fail(task: Task, error: string) {
  if (await workGone(task.workId)) return;
  await putTask({ ...task, status: 'failed', error, updatedAt: now() });
  void logEvent('task_failed', task.workId, { round: task.round ?? null, slot: task.slot ?? null, error: error.slice(0, 80) });
}

async function submit(task: Task, approval: Approval) {
  submitting.add(task.id);
  try {
    const images = await referenceImages(approval);
    const res = await submitImageTask({ model: task.model, prompt: approval.snapshot.prompt, ratio: approval.snapshot.ratio, images });
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
          await fail(task, `等了 ${GENERATION.timeoutMs / 60000} 分钟还没有结果，可以补齐这一张`);
          return;
        }
        await sleep(GENERATION.pollMs);
        let st;
        try {
          st = await getImageTaskStatus(task.gatewayId!, task.ledgerId);
          errors = 0;
        } catch (e) {
          const transient = e instanceof ApiCallError && (e.code === 'network' || (e.status ?? 0) >= 500);
          if (transient && ++errors < GENERATION.maxPollErrors) continue;
          throw e;
        }
        if (st.status === 'completed') {
          await collect(task);
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
      await fail(task, `查询生成结果失败：${errorText(e)}`);
    } finally {
      polling.delete(task.id);
    }
  })();
}

// 结果立刻存进本地数据库：网关只保留 1 小时，下载次数也有限
async function collect(task: Task) {
  if (await workGone(task.workId)) return;
  const blob = await downloadImageResult(task.gatewayId!, 0);
  const { width, height } = await imageSize(blob);
  const result: Result = {
    id: newId('res'),
    workId: task.workId,
    taskId: task.id,
    approvalId: task.approvalId!,
    round: task.round!,
    slot: task.slot!,
    blobId: newId('blob'),
    width,
    height,
    verdict: { real: 'none', style: 'none' },
    issues: [],
    note: '',
    createdAt: now(),
    exports: [],
  };
  await saveResult({ ...task, status: 'succeeded', updatedAt: now() }, result, blob);
  void logEvent('task_succeeded', task.workId, { round: task.round ?? null, slot: task.slot ?? null });
}

// 补齐失败的一张：沿用那一轮的批准，但批准必须仍然有效（PRD 4.2 第 1 条），次数受上限约束
export function retrySlot(workId: Id, round: number, slot: number): Promise<GenOutcome> {
  return serial(workId, async () => {
    const ctx = await loadContext(workId);
    const check = retryCheck(ctx.tasks, workId, round, slot);
    if (!check.ok) return { ok: false, reasons: [check.reason] };
    const prev = ctx.tasks.find((t) => t.round === round && t.slot === slot);
    const approval = prev?.approvalId ? await getApproval(prev.approvalId) : undefined;
    if (!approval || approval.usedRound !== round) return { ok: false, reasons: ['找不到这一轮的批准记录'] };
    const st = approvalStatus(approval, ctx.snapshot);
    if (st.kind !== 'valid') return { ok: false, reasons: ['批准后方案改过了，补齐需要重新批准'] };
    const task = newTask(workId, approval, round, slot, check.attempt);
    await putTask(task);
    void logEvent('retry', workId, { round, slot, attempt: check.attempt });
    void submit(task, approval);
    return { ok: true, round };
  });
}

// 打开页面时接着查询还没结束的任务；没来得及提交的标为失败，由用户决定是否补齐，不自动重新提交
let resumed = false;
export async function resumeActiveTasks() {
  if (resumed) return;
  resumed = true;
  for (const t of await activeTasks()) {
    if (t.gatewayId) poll(t);
    else if (!submitting.has(t.id)) await fail(t, '页面关闭时这张还没提交（没有扣费），可以补齐');
  }
}
