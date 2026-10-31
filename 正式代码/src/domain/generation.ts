import { BUDGET, CANDIDATES_PER_ROUND } from '@/config/budget';
import type { Id, Result, Task } from './types';

export const isActive = (t: Task) => t.status === 'queued' || t.status === 'running';

export const generating = (tasks: readonly Task[], workId: Id) =>
  tasks.some((t) => t.workId === workId && t.kind === 'scene' && isActive(t));

export const passed = (r: Result) => r.verdict.real === 'ok' && r.verdict.style === 'ok';

export const roundResults = (results: readonly Result[], workId: Id, round: number) =>
  results.filter((r) => r.workId === workId && r.round === round).sort((a, b) => a.slot - b.slot);

const slotTasks = (tasks: readonly Task[], workId: Id, round: number, slot: number) =>
  tasks
    .filter((t) => t.workId === workId && t.kind === 'scene' && t.round === round && t.slot === slot)
    .sort((a, b) => a.attempt - b.attempt);

export type SlotState = 'empty' | 'active' | 'succeeded' | 'failed';

export function slotState(tasks: readonly Task[], workId: Id, round: number, slot: number): SlotState {
  const last = slotTasks(tasks, workId, round, slot).at(-1);
  if (!last) return 'empty';
  if (isActive(last)) return 'active';
  return last.status === 'succeeded' ? 'succeeded' : 'failed';
}

// 补齐失败的一张：只在最后一次失败、且没超过次数上限时允许（AC-08.5：不无限重试）
export function retryCheck(
  tasks: readonly Task[],
  workId: Id,
  round: number,
  slot: number,
  limit = BUDGET.retriesPerSlot,
): { ok: true; attempt: number } | { ok: false; reason: string } {
  const list = slotTasks(tasks, workId, round, slot);
  const last = list.at(-1);
  if (!last) return { ok: false, reason: '这一张还没有生成过' };
  if (last.status !== 'failed') return { ok: false, reason: isActive(last) ? '这一张还在生成中' : '这一张已经成功了' };
  if (list.length > limit) return { ok: false, reason: `这一张已经补齐过 ${limit} 次，先改方案再重新生成` };
  return { ok: true, attempt: last.attempt + 1 };
}

export const roundSlots = () => Array.from({ length: CANDIDATES_PER_ROUND }, (_, i) => i);
