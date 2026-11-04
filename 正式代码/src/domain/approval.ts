import type { StepId } from '@/config/steps';
import { STYLE_LABELS, STYLE_REQUIRED } from '@/config/style';
import { styleConflicts } from './conflicts';
import { infoLabels, infoMissing } from './info';
import { activeUploads, diffBasis, diffSnapshot, styleValuesOf } from './snapshot';
import type { Approval, Asset, Basis, Snapshot, Work } from './types';

export type PromptStatus =
  | { kind: 'missing' }
  | { kind: 'stale'; changed: string[] }
  | { kind: 'unchecked' }
  | { kind: 'conflict'; conflicts: string[] }
  | { kind: 'ok' };

export function promptStatus(work: Work, current: Basis): PromptStatus {
  const p = work.prompt;
  if (!p || !p.text.trim()) return { kind: 'missing' };
  const changed = diffBasis(p.basis, current);
  if (changed.length) return { kind: 'stale', changed };
  if (p.sync === 'unchecked') return { kind: 'unchecked' };
  if (p.sync === 'conflict') return { kind: 'conflict', conflicts: p.conflicts };
  return { kind: 'ok' };
}

export interface Blocker {
  step: StepId;
  text: string;
}

// 批准前必须满足的条件；界面和小间的工具都用这一份
export function approvalBlockers(work: Work, assets: readonly Asset[], current: Basis, isGenerating: boolean): Blocker[] {
  const out: Blocker[] = [];
  if (!activeUploads(assets, work.id).length) out.push({ step: 'asset', text: '还没有作品照片' });
  else if (!work.assetsConfirmed) out.push({ step: 'asset', text: '商品资产还没确认' });
  else if (work.route === 'A' && !current.references.includes(work.whiteChoice ?? '')) {
    out.push({ step: 'asset', text: '还没选定白底图' });
  }
  const missing = infoMissing(work.info);
  if (missing.length) out.push({ step: 'info', text: `${infoLabels(missing)}还没填（不知道可以标「未知」）` });
  if (work.story.summaryState !== 'confirmed') out.push({ step: 'story', text: '共创总结还没确认' });

  const style = styleValuesOf(work);
  const lack = STYLE_REQUIRED.filter((k) => !style[k]);
  if (lack.length) out.push({ step: 'plan', text: `风格还缺：${lack.map((k) => STYLE_LABELS[k]).join('、')}` });
  for (const c of styleConflicts(style)) out.push({ step: 'plan', text: c });

  const ps = promptStatus(work, current);
  if (ps.kind === 'missing') out.push({ step: 'plan', text: '提示词还没写' });
  if (ps.kind === 'stale') out.push({ step: 'plan', text: `提示词写完后改了：${ps.changed.join('、')}，需要重写或确认` });
  if (ps.kind === 'unchecked') out.push({ step: 'plan', text: '提示词改过，还没核对方案是否一致' });
  if (ps.kind === 'conflict') out.push({ step: 'plan', text: `提示词和方案有矛盾：${ps.conflicts.join('；')}` });

  if (isGenerating) out.push({ step: 'output', text: '已有任务在生成中' });
  return out;
}

export type ApprovalStatus = { kind: 'none' } | { kind: 'valid' } | { kind: 'stale'; changed: string[] };

export function approvalStatus(approval: Approval | null, current: Snapshot): ApprovalStatus {
  if (!approval) return { kind: 'none' };
  const changed = diffSnapshot(approval.snapshot, current);
  return changed.length ? { kind: 'stale', changed } : { kind: 'valid' };
}

// 当前方案已经有有效批准时它到了哪一步：还没生成、这一轮正在生成、已经生成过。
// 批准卡片工具和给小间的作品状态都按它说明，不把「正在生成」当成还要批准的理由（BC-009）
export function approvedPhase(approval: Approval | null, current: Snapshot, isGenerating: boolean): 'unused' | 'generating' | 'used' | null {
  if (!approval || approvalStatus(approval, current).kind !== 'valid') return null;
  if (approval.usedRound == null) return 'unused';
  return isGenerating ? 'generating' : 'used';
}

// 发起生成的条件（PRD 4.2 第 1 条）：有效批准、这版批准还没用过、没有正在生成的任务
export function generationBlockers(approval: Approval | null, current: Snapshot, isGenerating: boolean): string[] {
  const status = approvalStatus(approval, current);
  if (status.kind === 'none') return ['方案还没批准'];
  if (status.kind === 'stale') return [`批准后改了：${status.changed.join('、')}，需要重新批准`];
  const out: string[] = [];
  if (approval?.usedRound != null) out.push('这版批准已经生成过一轮，要再生成需重新批准');
  if (isGenerating) out.push('已有任务在生成中');
  return out;
}
