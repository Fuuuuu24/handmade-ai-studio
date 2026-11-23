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

// 两种出图各自不能和哪种生成同时进行（技术写法 13.6）：背景不和合成同时（合成快照里有背景图），
// 合成不和三视图同时（三视图进合成快照）。发起一轮（domain/approval.ts）和补齐一张（retryCheck）都查这张表
const CROSS_BUSY = {
  backdrop: { busy: 'scene', text: '正在合成这一轮候选，等结束后再生成背景' },
  scene: { busy: 'views', text: '三视图还在生成' },
} as const satisfies Record<'backdrop' | 'scene', { busy: keyof Busy; text: string }>;

export function crossBusy(tasks: readonly Task[], workId: Id, kind: 'backdrop' | 'scene'): string | null {
  const c = CROSS_BUSY[kind];
  return busyOf(tasks, workId)[c.busy] ? c.text : null;
}

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

// 这一张最后一次尝试。按 attempt 找，不按数组顺序：listTasks 读出的任务不排序，编号又是随机的
export const lastSlotTask = (tasks: readonly Task[], workId: Id, kind: 'backdrop' | 'scene', round: number, slot: number) =>
  slotTasks(tasks, workId, kind, round, slot).at(-1);

export type SlotState = 'empty' | 'active' | 'succeeded' | 'failed';

export function slotState(tasks: readonly Task[], workId: Id, kind: 'backdrop' | 'scene', round: number, slot: number): SlotState {
  const last = lastSlotTask(tasks, workId, kind, round, slot);
  if (!last) return 'empty';
  if (isActive(last)) return 'active';
  return last.status === 'succeeded' ? 'succeeded' : 'failed';
}

// 补齐失败的一张（retrySlot 和两个「补齐这一张」按钮都用它）：别的种类在生成时不能补，条件和发起一轮一样（crossBusy）；
// 同一种的另一张还在生成，照样可以补。这一张要最后一次失败、没超过次数上限（AC-08.5：不无限重试）。
// 那一轮的批准是否仍有效要读数据库，在 retrySlot 里查
export function retryCheck(
  tasks: readonly Task[],
  workId: Id,
  kind: 'backdrop' | 'scene',
  round: number,
  slot: number,
  limit = BUDGET.retriesPerSlot,
): { ok: true; attempt: number } | { ok: false; reason: string } {
  const cross = crossBusy(tasks, workId, kind);
  if (cross) return { ok: false, reason: cross };
  const list = slotTasks(tasks, workId, kind, round, slot);
  const last = list.at(-1);
  if (!last) return { ok: false, reason: '这一张还没有生成过' };
  if (last.status !== 'failed') return { ok: false, reason: isActive(last) ? '这一张还在生成中' : '这一张已经成功了' };
  if (list.length > limit) return { ok: false, reason: `这一张已经补齐过 ${limit} 次，先改方案再重新生成` };
  return { ok: true, attempt: last.attempt + 1 };
}
