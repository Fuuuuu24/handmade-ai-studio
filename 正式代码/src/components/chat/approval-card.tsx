'use client';

import { approvalStatus } from '@/domain/approval';
import { useWorkspace } from '@/components/workspace/context';
import { ApproveButton } from '@/components/plan/approve-button';
import { BlockerList, PlanSummary } from '@/components/plan/plan-summary';

// 小间放出的批准卡片：内容按当前作品实时显示；过去的卡片收成一行
export function ApprovalCard({ active, done }: { active: boolean; done: boolean }) {
  const { ctx, setViewing } = useWorkspace();
  const st = approvalStatus(ctx.approval, ctx.snapshot);
  const approved = st.kind === 'valid' && ctx.approval;

  if (!active || approved) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-canvas px-2.5 py-2 text-aux text-ink-2">
        <span className="min-w-0 flex-1 truncate">
          {approved ? `已批准第 ${ctx.approval!.version} 版方案` : '批准卡片'}
          {approved && ctx.approval!.usedRound != null ? `，已用于第 ${ctx.approval!.usedRound} 轮生成` : ''}
        </span>
        <button type="button" className="mini-btn" onClick={() => setViewing(approved ? 'output' : 'plan')}>
          {approved ? '看结果' : '看方案'}
        </button>
      </div>
    );
  }
  if (!done) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-white p-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong),var(--shadow-sm)]">
      <div className="flex items-center gap-2">
        <strong className="text-body">确认这版方案</strong>
        <button type="button" className="ml-auto text-aux text-muted underline decoration-line-hover underline-offset-2 hover:text-ink" onClick={() => setViewing('plan')}>
          完整方案和提示词
        </button>
      </div>
      <PlanSummary compact />
      <BlockerList />
      <ApproveButton />
      <p className="text-label text-muted">批准后按这版方案和提示词生成两张；之后再改任何内容，需要重新批准。</p>
    </div>
  );
}
