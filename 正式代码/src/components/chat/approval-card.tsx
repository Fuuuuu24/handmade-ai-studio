'use client';

import { backdropApprovalStatus, sceneApprovalStatus } from '@/domain/approval';
import type { PromptKind } from '@/domain/types';
import { useWorkspace } from '@/components/workspace/context';
import { ApproveButton } from '@/components/plan/approve-button';
import { BackdropPlanSummary, BlockerList, PlanSummary } from '@/components/plan/plan-summary';

// 小间放出的批准卡片（背景方案或合成方案）：内容按当前作品实时显示；过去的卡片收成一行
export function ApprovalCard({ kind, active, done }: { kind: PromptKind; active: boolean; done: boolean }) {
  const { ctx, setViewing } = useWorkspace();
  const backdrop = kind === 'backdrop';
  const st = backdrop ? backdropApprovalStatus(ctx) : sceneApprovalStatus(ctx);
  const approval = backdrop ? ctx.backdropApproval : ctx.approval;
  const approved = st.kind === 'valid' && approval;
  const what = backdrop ? '背景方案' : '方案';
  const step = backdrop ? 'backdrop' : approved ? 'result' : 'placement';

  if (!active || approved) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-canvas px-2.5 py-2 text-aux text-ink-2">
        <span className="min-w-0 flex-1 truncate">
          {approved ? `已批准第 ${approval.version} 版${what}` : `${what}的批准卡片`}
          {approved && approval.usedRound != null ? `，已用于第 ${approval.usedRound} 轮生成` : ''}
        </span>
        <button type="button" className="mini-btn" onClick={() => setViewing(step)}>
          {backdrop ? '看背景' : approved ? '看结果' : '看方案'}
        </button>
      </div>
    );
  }
  if (!done) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-white p-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong),var(--shadow-sm)]">
      <div className="flex items-center gap-2">
        <strong className="text-body">{backdrop ? '确认这版背景方案' : '确认这版方案'}</strong>
        <button type="button" className="ml-auto text-aux text-muted underline decoration-line-hover underline-offset-2 hover:text-ink" onClick={() => setViewing(backdrop ? 'backdrop' : 'placement')}>
          完整方案和提示词
        </button>
      </div>
      {backdrop ? <BackdropPlanSummary /> : <PlanSummary compact />}
      <BlockerList kind={kind} />
      <ApproveButton kind={kind} />
      <p className="text-label text-muted">
        {backdrop ? '批准后按这版方案生成两张背景，你选一张；之后再改背景风格，需要重新批准。' : '批准后按这版方案和提示词生成两张；之后再改任何内容，需要重新批准。'}
      </p>
    </div>
  );
}
