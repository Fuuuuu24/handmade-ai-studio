import { STEPS, type StepId } from '@/config/steps';
import { approvalStatus } from './approval';
import { generating, passed, roundResults, roundSlots, slotState } from './generation';
import { infoDone } from './info';
import { activeUploads } from './snapshot';
import type { Approval, Asset, Result, Snapshot, Task, Work } from './types';

export interface StatusInput {
  work: Work;
  assets: readonly Asset[];
  tasks: readonly Task[];
  results: readonly Result[];
  approval: Approval | null;
  current: Snapshot;
}

export type WorkStatusKey =
  | 'draft'
  | 'assets'
  | 'story'
  | 'summary'
  | 'plan'
  | 'ready'
  | 'generating'
  | 'failed'
  | 'review'
  | 'done';

export const WORK_STATUS_TEXT: Record<WorkStatusKey, string> = {
  draft: '草稿',
  assets: '资产待确认',
  story: '共创中',
  summary: '总结待确认',
  plan: '方案待确认',
  ready: '可生成',
  generating: '生成中',
  failed: '生成失败',
  review: '待验收',
  done: '已完成',
};

export type Tone = '' | 'warn' | 'ok';

const TONE: Record<WorkStatusKey, Tone> = {
  draft: '',
  assets: 'warn',
  story: '',
  summary: 'warn',
  plan: 'warn',
  ready: 'ok',
  generating: '',
  failed: 'warn',
  review: 'warn',
  done: 'ok',
};

// PRD 5.3 作品状态：由数据推导，不单独存
export function workStatusKey({ work, assets, tasks, results, approval, current }: StatusInput): WorkStatusKey {
  if (!activeUploads(assets, work.id).length) return 'draft';
  if (generating(tasks, work.id)) return 'generating';
  if (!work.assetsConfirmed) return 'assets';
  if (work.story.summaryState === 'none') return 'story';
  if (work.story.summaryState === 'draft') return 'summary';
  if (approvalStatus(approval, current).kind !== 'valid' || !approval) return 'plan';
  if (approval.usedRound == null) return 'ready';
  const round = approval.usedRound;
  const done = roundResults(results, work.id, round);
  if (done.some(passed)) return 'done';
  if (done.length) return 'review';
  return roundSlots().every((s) => slotState(tasks, work.id, round, s) === 'failed') ? 'failed' : 'review';
}

export const workStatus = (input: StatusInput) => {
  const key = workStatusKey(input);
  return { key, text: WORK_STATUS_TEXT[key], tone: TONE[key] };
};

export type StepState = 'done' | 'todo' | 'stale';

export function stepStates({ work, results, approval, current }: StatusInput): Record<StepId, StepState> {
  const ap = approvalStatus(approval, current);
  const round = ap.kind === 'valid' ? approval?.usedRound : null;
  const anyResults = results.some((r) => r.workId === work.id);
  return {
    asset: work.assetsConfirmed ? 'done' : 'todo',
    info: infoDone(work.info) ? 'done' : 'todo',
    story: work.story.summaryState === 'confirmed' ? 'done' : 'todo',
    plan: ap.kind === 'valid' ? 'done' : ap.kind === 'stale' ? 'stale' : 'todo',
    output:
      round != null && roundResults(results, work.id, round).some(passed)
        ? 'done'
        : anyResults && round == null
          ? 'stale'
          : 'todo',
  };
}

// 当前该做的一步：按顺序第一个没完成的
export function currentStep(states: Record<StepId, StepState>): StepId {
  return STEPS.find((s) => states[s.id] !== 'done')?.id ?? 'output';
}
