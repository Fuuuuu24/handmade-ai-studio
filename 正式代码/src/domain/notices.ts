import { VIEW_NAMES } from '@/config/views';
import { VERDICT_SHORT } from '@/config/verdict';
import { backdropCandidates } from './backdrops';
import { isActive, lastSlotTask, roundResults, slotsOf, slotState } from './generation';
import type { Result, Task, WorkState } from './types';

/* 生成完成和验收的通知（PRD AC-11.3a、AC-11.3c，技术写法 13.12 第 4 条）：浏览器代用户告诉小间。
   任务结束时 notifiedAt 记为 null，发出通知时写上时间；同一种生成（背景和合成按轮次）全部结束才发，一批合成一条。 */

export interface NoticeBatch {
  kind: Task['kind'];
  round?: number;
  tasks: Task[]; // 这次要通知的任务（还没通知过的）
}

// 可以发通知的批次：三视图没有还在生成的；背景、合成那一轮两张都有结果（含部分失败）
export function pendingNotices(s: WorkState): NoticeBatch[] {
  const mine = s.tasks.filter((t) => t.workId === s.work.id);
  const unsent = (t: Task) => t.notifiedAt === null && !isActive(t);
  const out: NoticeBatch[] = [];
  const views = mine.filter((t) => t.kind === 'view');
  if (!views.some(isActive) && views.some(unsent)) out.push({ kind: 'view', tasks: views.filter(unsent) });
  for (const kind of ['backdrop', 'scene'] as const) {
    const rounds = [...new Set(mine.filter((t) => t.kind === kind && unsent(t)).map((t) => t.round!))].sort((a, b) => a - b);
    for (const round of rounds) {
      const inRound = mine.filter((t) => t.kind === kind && t.round === round);
      if (inRound.some(isActive)) continue;
      out.push({ kind, round, tasks: inRound.filter(unsent) });
    }
  }
  return out;
}

// 这一张最后一次失败的原因（只在这一张的状态是失败时用，最后一次就是失败的那次）
const failText = (s: WorkState, kind: 'backdrop' | 'scene', round: number, slot: number) =>
  lastSlotTask(s.tasks, s.work.id, kind, round, slot)?.error ?? '原因未知';

// 通知的文字：按这一批（或这一轮）现在的样子写，补齐后再通知时说的也是整轮的情况
export function noticeText(s: WorkState, b: NoticeBatch): string {
  const { work } = s;
  if (b.kind === 'view') {
    const parts = b.tasks.map((t) => `${VIEW_NAMES[t.view!]}${t.status === 'succeeded' ? '生成好了，待用户对照原图确认' : `没生成出来（${t.error ?? '原因未知'}）`}`);
    return `【通知：三视图】${parts.join('；')}。三视图要用户对照原图看：他觉得可以用，问他要不要替他点「可以用」（ask_confirm）；不像的可以单独重做。`;
  }
  const round = b.round!;
  if (b.kind === 'backdrop') {
    const cands = backdropCandidates(s.backdrops, work.id, round);
    const parts = slotsOf('backdrop').map((slot) => {
      const c = cands.find((x) => x.slot === slot);
      if (c) return `背景 ${slot + 1} 生成好了（${c.id}）`;
      return slotState(s.tasks, work.id, 'backdrop', round, slot) === 'failed' ? `背景 ${slot + 1} 没生成出来（${failText(s, 'backdrop', round, slot)}），可以补齐` : `背景 ${slot + 1} 还没有`;
    });
    return `【通知：背景图】第 ${round} 轮：${parts.join('；')}。选哪张要用户看过图决定，图里不能有饰品，请他把关：他在画布上点「用这张」，或你问过、他同意后代点。`;
  }
  const done = roundResults(s.results, work.id, round);
  const parts = slotsOf('scene').map((slot) => {
    if (done.some((r) => r.slot === slot)) return `候选 ${slot + 1} 生成好了`;
    return slotState(s.tasks, work.id, 'scene', round, slot) === 'failed' ? `候选 ${slot + 1} 没生成出来（${failText(s, 'scene', round, slot)}），可以补齐` : `候选 ${slot + 1} 还没有`;
  });
  return `【通知：候选】第 ${round} 轮：${parts.join('；')}。两项验收要用户看过图判断：他在画布上点，或你问过、他同意后代点。`;
}

// 已经告诉小间的验收内容：两项结果、问题标签和说明，变了才再通知
export const verdictKey = (r: Result) => `${r.verdict.real}/${r.verdict.style}/${[...r.issues].sort().join(',')}/${r.note.trim()}`;

// 可以发验收通知的候选：两项都点了、和上次通知的不一样，而且用户停手满 settleMs（留时间勾问题、写说明）。
// waitMs：还有候选在等停手，多久后再看一次
export function pendingVerdicts(s: WorkState, now: number, settleMs: number): { ready: Result[]; waitMs: number | null } {
  const cands = s.results.filter((r) => r.workId === s.work.id && r.verdict.real !== 'none' && r.verdict.style !== 'none' && r.notifiedVerdict !== verdictKey(r));
  const left = (r: Result) => settleMs - (now - (r.verdictAt ?? 0));
  const waiting = cands.filter((r) => left(r) > 0);
  return {
    ready: cands.filter((r) => left(r) <= 0).sort((a, b) => a.round - b.round || a.slot - b.slot),
    waitMs: waiting.length ? Math.min(...waiting.map(left)) : null,
  };
}

export function verdictText(r: Result): string {
  const parts = [`像不像实物：${VERDICT_SHORT.real[r.verdict.real]}`, `风格对不对：${VERDICT_SHORT.style[r.verdict.style]}`];
  if (r.issues.length) parts.push(`问题：${r.issues.join('、')}`);
  if (r.note.trim()) parts.push(`用户说：${r.note.trim()}`);
  const passed = r.verdict.real === 'ok' && r.verdict.style === 'ok';
  return `【通知：验收】第 ${r.round} 轮候选 ${r.slot + 1}：${parts.join('；')}。${passed ? '两项都满意，可以放下载卡片。' : '这是用户的判断，不要自己改；要改先问他。'}`;
}
