import { FLOW_STEPS, type StepId } from '@/config/steps';
import { sceneApprovalStatus } from './approval';
import { activeUploads, viewsDone } from './assets';
import { backdropCandidates, backdropDone } from './backdrops';
import { busyOf, passed, roundResults, roundSlots, slotState } from './generation';
import { infoDone } from './info';
import type { WorkState } from './types';

export type WorkStatusKey =
  | 'draft'
  | 'assets'
  | 'info'
  | 'backdropMode'
  | 'story'
  | 'summary'
  | 'backdropPlan'
  | 'backdropGenerating'
  | 'backdropPick'
  | 'plan'
  | 'ready'
  | 'generating'
  | 'failed'
  | 'review'
  | 'done';

// PRD 5.3 的作品状态
export const WORK_STATUS_TEXT: Record<WorkStatusKey, string> = {
  draft: '草稿',
  assets: '资产待确认',
  info: '信息待处理',
  backdropMode: '背景待选择方式',
  story: '共创中',
  summary: '总结待确认',
  backdropPlan: '背景待批准',
  backdropGenerating: '背景生成中',
  backdropPick: '背景待选定',
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
  info: 'warn',
  backdropMode: '',
  story: '',
  summary: 'warn',
  backdropPlan: 'warn',
  backdropGenerating: '',
  backdropPick: 'warn',
  plan: 'warn',
  ready: 'ok',
  generating: '',
  failed: 'warn',
  review: 'warn',
  done: 'ok',
};

// 背景这一步还没完成时处在哪个状态：没选做法；用模板但还没选；自己生成时按共创、批准、选定推进
function backdropStatusKey(s: WorkState): WorkStatusKey {
  const { work } = s;
  if (!work.backdropMode) return 'backdropMode';
  if (work.backdropMode === 'library') return 'backdropPick';
  if (work.story.summaryState === 'none') return 'story';
  if (work.story.summaryState === 'draft') return 'summary';
  if (work.backdropRound > 0 && backdropCandidates(s.backdrops, work.id, work.backdropRound).length && !work.backdropId) return 'backdropPick';
  return 'backdropPlan';
}

// 作品状态：由数据推导，不单独存。正在生成的先说；其余按这件作品的流程顺序，第一个没做完的那一步说了算
export function workStatusKey(s: WorkState): WorkStatusKey {
  const { work } = s;
  const busy = busyOf(s.tasks, work.id);
  if (busy.scene) return 'generating';
  if (busy.backdrop) return 'backdropGenerating';
  for (const step of FLOW_STEPS[work.flow]) {
    if (step === 'product' && !viewsDone(s.assets, work.id)) return activeUploads(s.assets, work.id).length ? 'assets' : 'draft';
    if (step === 'info' && !infoDone(work.info)) return 'info';
    if (step === 'backdrop' && !backdropDone(work, s.backdrop)) return backdropStatusKey(s);
    if (step === 'placement' && sceneApprovalStatus(s).kind !== 'valid') return 'plan';
  }
  const approval = s.approval!;
  if (approval.usedRound == null) return 'ready';
  const round = approval.usedRound;
  const done = roundResults(s.results, work.id, round);
  if (done.some(passed)) return 'done';
  if (done.length) return 'review';
  return roundSlots().every((slot) => slotState(s.tasks, work.id, 'scene', round, slot) === 'failed') ? 'failed' : 'review';
}

export const workStatus = (s: WorkState) => {
  const key = workStatusKey(s);
  return { key, text: WORK_STATUS_TEXT[key], tone: TONE[key] };
};

export type StepState = 'done' | 'todo' | 'stale';

// 每一步的「完成」条件（技术写法 13.2）
export function stepStates(s: WorkState): Record<StepId, StepState> {
  const { work } = s;
  const ap = sceneApprovalStatus(s);
  const round = ap.kind === 'valid' ? s.approval?.usedRound : null;
  const anyResults = s.results.some((r) => r.workId === work.id);
  return {
    product: viewsDone(s.assets, work.id) ? 'done' : 'todo',
    info: infoDone(work.info) ? 'done' : 'todo',
    backdrop: backdropDone(work, s.backdrop) ? 'done' : 'todo',
    placement: ap.kind === 'valid' ? 'done' : ap.kind === 'stale' ? 'stale' : 'todo',
    result:
      round != null && roundResults(s.results, work.id, round).some(passed)
        ? 'done'
        : anyResults && round == null
          ? 'stale'
          : 'todo',
  };
}

// 当前该做的一步：按这件作品的流程，第一个没完成的
export function currentStep(s: WorkState, states: Record<StepId, StepState> = stepStates(s)): StepId {
  return FLOW_STEPS[s.work.flow].find((id) => states[id] !== 'done') ?? 'result';
}
