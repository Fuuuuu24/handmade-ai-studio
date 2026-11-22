import { BUDGET, CANDIDATES_PER_ROUND } from '@/config/budget';
import { BACKDROP } from '@/config/backdrops';
import type { Id, Result, Task, TaskKind } from './types';

export const isActive = (t: Task) => t.status === 'queued' || t.status === 'running';

// 某种生成是不是正在进行（技术写法 13.6：生成中按任务类型分开）
export const generating = (tasks: readonly Task[], workId: Id, kind: TaskKind) =>
  tasks.some((t) => t.workId === workId && t.kind === kind && isActive(t));

export interface Busy {
  views: boolean; // 三视图生成中：锁照片
  backdrop: boolean; // 背景生成中：锁背景风格和背景提示词
  scene: boolean; // 合成生成中：锁摆放卡、合成提示词，以及合成快照里的其他内容
}

export const busyOf = (tasks: readonly Task[], workId: Id): Busy => ({
  views: generating(tasks, workId, 'view'),
  backdrop: generating(tasks, workId, 'backdrop'),
  scene: generating(tasks, workId, 'scene'),
});

export const anyBusy = (b: Busy) => b.views || b.backdrop || b.scene;

export const passed = (r: Result) => r.verdict.real === 'ok' && r.verdict.style === 'ok';

export const roundResults = (results: readonly Result[], workId: Id, round: number) =>
  results.filter((r) => r.workId === workId && r.round === round).sort((a, b) => a.slot - b.slot);

// 每轮几张：合成两张候选，背景两张选一张
export const slotsOf = (kind: 'backdrop' | 'scene') =>
  Array.from({ length: kind === 'backdrop' ? BACKDROP.count : CANDIDATES_PER_ROUND }, (_, i) => i);

export const roundSlots = () => slotsOf('scene');

export const slotTasks = (tasks: readonly Task[], workId: Id, kind: 'backdrop' | 'scene', round: number, slot: number) =>
  tasks
    .filter((t) => t.workId === workId && t.kind === kind && t.round === round && t.slot === slot)
    .sort((a, b) => a.attempt - b.attempt);

export type SlotState = 'empty' | 'active' | 'succeeded' | 'failed';

export function slotState(tasks: readonly Task[], workId: Id, kind: 'backdrop' | 'scene', round: number, slot: number): SlotState {
  const last = slotTasks(tasks, workId, kind, round, slot).at(-1);
  if (!last) return 'empty';
  if (isActive(last)) return 'active';
  return last.status === 'succeeded' ? 'succeeded' : 'failed';
}

// 补齐失败的一张：只在最后一次失败、且没超过次数上限时允许（AC-08.5：不无限重试）
export function retryCheck(
  tasks: readonly Task[],
  workId: Id,
  kind: 'backdrop' | 'scene',
  round: number,
  slot: number,
  limit = BUDGET.retriesPerSlot,
): { ok: true; attempt: number } | { ok: false; reason: string } {
  const list = slotTasks(tasks, workId, kind, round, slot);
  const last = list.at(-1);
  if (!last) return { ok: false, reason: '这一张还没有生成过' };
  if (last.status !== 'failed') return { ok: false, reason: isActive(last) ? '这一张还在生成中' : '这一张已经成功了' };
  if (list.length > limit) return { ok: false, reason: `这一张已经补齐过 ${limit} 次，先改方案再重新生成` };
  return { ok: true, attempt: last.attempt + 1 };
}
