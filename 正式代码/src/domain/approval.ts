import { maxRefsOf } from '@/config/models';
import type { StepId } from '@/config/steps';
import { BACKDROP_REQUIRED, SCENE_REQUIRED, STYLE_LABELS } from '@/config/style';
import { VIEW_ANGLES } from '@/config/views';
import { angleNames, missingAngles, viewsDone } from './assets';
import { backdropDone } from './backdrops';
import { backdropConflicts, sceneConflicts } from './conflicts';
import { busyOf } from './generation';
import { BACKDROP_INFO, infoLabels, infoMissing, pendingCore } from './info';
import {
  backdropBasisOf,
  backdropSnapshotOf,
  backdropStyleOf,
  diffBackdropBasis,
  diffBackdropSnapshot,
  diffSceneBasis,
  diffSceneSnapshot,
  sceneBasisOf,
  sceneSnapshotOf,
  sceneStyleOf,
} from './snapshot';
import type { BackdropApproval, BackdropBasis, PromptState, SceneApproval, SceneBasis, Work, WorkState } from './types';

/* 两种批准（技术写法 13.4、13.5）：自己生成背景时先批准背景方案，生成两张选一张；再批准合成方案，生成两张候选。
   批准只能由用户在界面上操作产生（PRD 4.2 第 1 条）；这里判断能不能批准、批准是否失效、能不能发起生成。 */

// 合成参考图固定 1 张背景图＋3 张三视图（AC-02.3a）
export const SCENE_REFS = VIEW_ANGLES.length + 1;

export type PromptStatus =
  | { kind: 'missing' }
  | { kind: 'stale'; changed: string[] }
  | { kind: 'unchecked' }
  | { kind: 'conflict'; conflicts: string[] }
  | { kind: 'ok' };

function promptStatusOf<B>(p: PromptState<B> | null, current: B, diff: (a: B, b: B) => string[]): PromptStatus {
  if (!p || !p.text.trim()) return { kind: 'missing' };
  const changed = diff(p.basis, current);
  if (changed.length) return { kind: 'stale', changed };
  if (p.sync === 'unchecked') return { kind: 'unchecked' };
  if (p.sync === 'conflict') return { kind: 'conflict', conflicts: p.conflicts };
  return { kind: 'ok' };
}

export const backdropPromptStatus = (work: Work, current: BackdropBasis = backdropBasisOf(work)) =>
  promptStatusOf(work.backdropPrompt, current, diffBackdropBasis);

export const scenePromptStatus = (work: Work, current: SceneBasis) => promptStatusOf(work.prompt, current, diffSceneBasis);

export interface Blocker {
  step: StepId;
  text: string;
}

export const PROMPT_NAMES = { backdrop: '背景提示词', scene: '合成提示词' } as const;

function promptBlockers(ps: PromptStatus, step: StepId, name: string): Blocker[] {
  if (ps.kind === 'missing') return [{ step, text: `${name}还没写` }];
  if (ps.kind === 'stale') return [{ step, text: `${name}写完后改了：${ps.changed.join('、')}，需要重写或确认` }];
  if (ps.kind === 'unchecked') return [{ step, text: `${name}改过，还没核对和方案是否一致` }];
  if (ps.kind === 'conflict') return [{ step, text: `${name}和方案有矛盾：${ps.conflicts.join('；')}` }];
  return [];
}

const SELECTED = '已经选定了背景图；要重新生成，先点「重新设计背景」';

// 背景批准前必须满足的条件（只在「自己生成」时）；界面和小间的工具都用这一份
export function backdropApprovalBlockers(s: WorkState): Blocker[] {
  const { work } = s;
  if (work.backdropMode !== 'generate') return [{ step: 'backdrop', text: '背景选的是模板库里的，不需要生成' }];
  const busy = busyOf(s.tasks, work.id);
  const out: Blocker[] = [];
  if (work.backdropId) out.push({ step: 'backdrop', text: SELECTED });
  const missing = infoMissing(work.info, BACKDROP_INFO);
  if (missing.length) out.push({ step: 'info', text: `${infoLabels(missing)}还没填（不知道可以标「未知」）` });
  if (work.story.summaryState !== 'confirmed') out.push({ step: 'backdrop', text: '共创总结还没确认' });
  const style = backdropStyleOf(work);
  const lack = BACKDROP_REQUIRED.filter((k) => !style[k]);
  if (lack.length) out.push({ step: 'backdrop', text: `背景风格还缺：${lack.map((k) => STYLE_LABELS[k]).join('、')}` });
  for (const c of backdropConflicts(style)) out.push({ step: 'backdrop', text: c });
  out.push(...promptBlockers(backdropPromptStatus(work), 'backdrop', PROMPT_NAMES.backdrop));
  if (busy.backdrop) out.push({ step: 'backdrop', text: '背景正在生成中' });
  if (busy.scene) out.push({ step: 'result', text: '正在合成这一轮候选，等结束后再生成背景' });
  return out;
}

// 合成批准前必须满足的条件；界面和小间的工具都用这一份
export function sceneApprovalBlockers(s: WorkState, current: SceneBasis = sceneBasisOf(s.work, s.assets)): Blocker[] {
  const { work } = s;
  const busy = busyOf(s.tasks, work.id);
  const out: Blocker[] = [];
  const missing = missingAngles(s.assets, work.id);
  if (missing.length) out.push({ step: 'product', text: `还缺${angleNames(missing)}照片` });
  else if (busy.views) out.push({ step: 'product', text: '三视图还在生成' });
  else if (!viewsDone(s.assets, work.id)) out.push({ step: 'product', text: '三视图还没全部确认' });
  const lackInfo = infoMissing(work.info);
  if (lackInfo.length) out.push({ step: 'info', text: `${infoLabels(lackInfo)}还没填（不知道可以标「未知」）` });
  if (!work.backdropId) out.push({ step: 'backdrop', text: '还没选定背景图' });
  else if (!s.backdrop) out.push({ step: 'backdrop', text: '选定的背景图找不到了，请重新选一张' });
  else if (!backdropDone(work, s.backdrop)) out.push({ step: 'backdrop', text: '共创总结还没确认' });

  const style = sceneStyleOf(work);
  const lack = SCENE_REQUIRED.filter((k) => !style[k]);
  if (lack.length) out.push({ step: 'placement', text: `摆放还缺：${lack.map((k) => STYLE_LABELS[k]).join('、')}` });
  for (const c of sceneConflicts(style)) out.push({ step: 'placement', text: c });
  // 以后换参考图上限更小的模型时挡批准（技术写法 13.5）；现在 4 个候选模型上限都是 4
  const maxRefs = maxRefsOf(work.imageModel);
  if (maxRefs < SCENE_REFS) {
    out.push({ step: 'placement', text: `这个生图模型最多收 ${maxRefs} 张参考图，合成要 ${SCENE_REFS} 张（背景图和三视图），请换一个模型` });
  }
  out.push(...promptBlockers(scenePromptStatus(work, current), 'placement', PROMPT_NAMES.scene));
  if (busy.scene) out.push({ step: 'result', text: '已有任务在生成中' });
  return out;
}

// 小间写提示词前，核心信息里的建议要先处理完（UX-02，2026-11-06 用户选定）：用户接受建议会改变提示词依据，
// 先写好的提示词一接受就过期，还得再核对一遍。执行器据此拒绝，画布上的「让小间写」也要等处理完
export function promptWriteBlocker(work: Work): Blocker | null {
  const keys = pendingCore(work.info);
  return keys.length ? { step: 'info', text: `还有 ${keys.length} 条信息建议没处理：${infoLabels(keys)}` } : null;
}

// 写背景提示词：只在「自己生成」、还没选定背景图时（技术写法 13.7）
export function backdropPromptWriteBlocker(work: Work): Blocker | null {
  if (work.backdropMode !== 'generate') return { step: 'backdrop', text: '背景选的是模板库里的，不需要写背景提示词' };
  if (work.backdropId) return { step: 'backdrop', text: SELECTED };
  return promptWriteBlocker(work);
}

// 写合成提示词：要有选定的背景图和三张确认过的三视图（技术写法 13.7）
export function scenePromptWriteBlocker(s: WorkState): Blocker | null {
  const pending = promptWriteBlocker(s.work);
  if (pending) return pending;
  if (!viewsDone(s.assets, s.work.id)) return { step: 'product', text: '三视图还没全部确认' };
  if (!s.backdrop) return { step: 'backdrop', text: s.work.backdropId ? '选定的背景图找不到了' : '还没选定背景图' };
  return null;
}

// 批准前的提醒，不挡批准（2026-11-06 用户选定）：核心信息里小间的建议还没接受或忽略。
// 没接受的建议不进提示词，其中可能有保真要求（比如数量、结构），批准前提醒用户看一眼
export function approvalReminders(work: Work): Blocker[] {
  const pending = promptWriteBlocker(work);
  return pending ? [{ ...pending, text: `${pending.text}；没接受的不会用于生成` }] : [];
}

export type ApprovalStatus = { kind: 'none' } | { kind: 'valid' } | { kind: 'stale'; changed: string[] };

function statusOf<S>(approval: { snapshot: S } | null, current: S, diff: (a: S, b: S) => string[]): ApprovalStatus {
  if (!approval) return { kind: 'none' };
  const changed = diff(approval.snapshot, current);
  return changed.length ? { kind: 'stale', changed } : { kind: 'valid' };
}

export const backdropApprovalStatus = (s: Pick<WorkState, 'work' | 'backdropApproval'>, approval = s.backdropApproval) =>
  statusOf(approval, backdropSnapshotOf(s.work), diffBackdropSnapshot);

export const sceneApprovalStatus = (s: Pick<WorkState, 'work' | 'assets' | 'approval'>, approval = s.approval) =>
  statusOf(approval, sceneSnapshotOf(s.work, s.assets), diffSceneSnapshot);

// 当前方案已经有有效批准时它到了哪一步：还没生成、这一轮正在生成、已经生成过。
// 批准卡片工具和给小间的作品状态都按它说明，不把「正在生成」当成还要批准的理由（BC-009）
export function approvedPhase(
  approval: { usedRound: number | null } | null,
  status: ApprovalStatus,
  isGenerating: boolean,
): 'unused' | 'generating' | 'used' | null {
  if (!approval || status.kind !== 'valid') return null;
  if (approval.usedRound == null) return 'unused';
  return isGenerating ? 'generating' : 'used';
}

function roundBlockers(status: ApprovalStatus, approval: { usedRound: number | null } | null, none: string): string[] {
  if (status.kind === 'none' || !approval) return [none];
  if (status.kind === 'stale') return [`批准后改了：${status.changed.join('、')}，需要重新批准`];
  return approval.usedRound != null ? ['这版批准已经生成过一轮，要再生成需重新批准'] : [];
}

// 发起背景生成的条件（PRD 4.2 第 1 条）：有效批准、这版批准还没用过、没有冲突的生成在进行
export function backdropGenerationBlockers(s: WorkState, approval: BackdropApproval | null = s.backdropApproval): string[] {
  const busy = busyOf(s.tasks, s.work.id);
  const out = roundBlockers(backdropApprovalStatus(s, approval), approval, '背景方案还没批准');
  if (busy.backdrop) out.push('背景正在生成中');
  if (busy.scene) out.push('正在合成这一轮候选，等结束后再生成背景');
  return out;
}

// 发起合成的条件（PRD 4.2 第 1 条）
export function sceneGenerationBlockers(s: WorkState, approval: SceneApproval | null = s.approval): string[] {
  const busy = busyOf(s.tasks, s.work.id);
  const out = roundBlockers(sceneApprovalStatus(s, approval), approval, '方案还没批准');
  if (busy.scene) out.push('已有任务在生成中');
  if (busy.views) out.push('三视图还在生成');
  return out;
}
