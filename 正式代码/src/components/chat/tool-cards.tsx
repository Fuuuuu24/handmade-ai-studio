'use client';

import { useState, type ReactNode } from 'react';
import type { StyleKey } from '@/config/style';
import { exportResult } from '@/client/export';
import { mutateWork } from '@/client/work-store';
import { passed } from '@/domain/generation';
import { decideProposal } from '@/domain/work';
import { SceneSaveForm, ShopStyleForm } from '@/components/plan/library-forms';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/workspace/context';

/* 小间放进对话的卡片：方向选卡、下载、存布景和更新我的风格的提议。卡片只是入口，真正的写入和下载都由用户点按钮完成。 */

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-white p-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong),var(--shadow-sm)]">
      <strong className="text-body">{title}</strong>
      {children}
    </div>
  );
}

function Closed({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-canvas px-2.5 py-2 text-aux text-ink-2">{children}</div>;
}

// 「我不知道」时的方向卡片（AC-04.2）：点一张就把选择发给小间
export function PicksCard({ input, active }: { input: { question?: string; options: { title: string; reason: string }[] }; active: boolean }) {
  const { askAgent, busy } = useWorkspace();
  const off = !active || busy;
  return (
    <div className="flex flex-col gap-2">
      {input.question && <p className="text-aux text-muted">{input.question}</p>}
      <div className="grid grid-cols-1 gap-2">
        {input.options.map((o) => (
          <button
            key={o.title}
            type="button"
            disabled={off}
            onClick={() => askAgent(`我选「${o.title}」`)}
            className="flex flex-col items-start gap-0.5 rounded-lg bg-white px-3 py-2 text-left shadow-[inset_0_0_0_1px_var(--color-line-strong)] enabled:hover:shadow-[inset_0_0_0_1px_var(--color-line-hover),var(--shadow-sm)] disabled:opacity-60"
          >
            <span className="text-body font-medium">{o.title}</span>
            <span className="text-aux text-muted">{o.reason}</span>
          </button>
        ))}
      </div>
      {active && (
        <button type="button" className="self-start text-aux text-muted underline decoration-line-hover underline-offset-2 hover:text-ink" disabled={busy} onClick={() => askAgent('这几个方向都不太合适')}>
          都不太合适
        </button>
      )}
    </div>
  );
}

export function ExportCard({ round, candidate }: { round: number; candidate: number }) {
  const { ctx } = useWorkspace();
  const [problem, setProblem] = useState<string | null>(null);
  const result = ctx.results.find((r) => r.round === round && r.slot === candidate - 1);
  if (!result) return <Closed>第 {round} 轮候选 {candidate} 已不存在</Closed>;
  const ok = passed(result);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-canvas px-2.5 py-2 text-aux text-ink-2">
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1">
          第 {round} 轮候选 {candidate}
          {result.exports.length ? ` · 已导出 ${result.exports.length} 次` : ''}
        </span>
        <button
          type="button"
          className="mini-btn"
          disabled={!ok}
          title={ok ? undefined : '两项都验收满意后才能导出'}
          onClick={async () => {
            setProblem(null);
            const r = await exportResult(ctx.work.name, result);
            if (!r.ok) setProblem(r.reason);
          }}
        >
          <Icon name="download" className="size-3.5" />
          下载
        </button>
      </div>
      {problem && <p className="text-bad">没有导出：{problem}</p>}
    </div>
  );
}

function useDecision(toolCallId: string) {
  const { ctx, workId } = useWorkspace();
  return {
    decision: ctx.work.proposals?.[toolCallId],
    decide: (d: 'accepted' | 'declined') => void mutateWork(workId, (c) => decideProposal(c.work, toolCallId, d)),
  };
}

// 存为布景的提议（PRD 4.2 第 2 条）：用户在卡片上确认才保存
export function SceneProposalCard({ toolCallId, input, active }: { toolCallId: string; input: { name: string; updateSceneId?: string; reason?: string }; active: boolean }) {
  const { decision, decide } = useDecision(toolCallId);
  if (decision) return <Closed>{decision === 'accepted' ? `已存为布景「${input.name}」` : '没有存这套布景'}</Closed>;
  if (!active) return <Closed>存为布景的提议（未处理）</Closed>;
  return (
    <Card title="存成摄影布景？">
      {input.reason && <p className="text-aux text-ink-2">{input.reason}</p>}
      <SceneSaveForm defaultName={input.name} updateSceneId={input.updateSceneId} onSaved={() => decide('accepted')} onCancel={() => decide('declined')} cancelText="不用了" />
    </Card>
  );
}

// 更新我的风格的提议（AC-06.4）：列出修改前后，用户同意才写入
export function ShopProposalCard({ toolCallId, input, active }: { toolCallId: string; input: { fields: StyleKey[]; reason: string }; active: boolean }) {
  const { decision, decide } = useDecision(toolCallId);
  if (decision) return <Closed>{decision === 'accepted' ? '已更新我的风格' : '没有更新我的风格'}</Closed>;
  if (!active) return <Closed>更新我的风格的提议（未处理）</Closed>;
  return (
    <Card title="更新我的风格？">
      <ShopStyleForm fields={input.fields} reason={input.reason} onSaved={() => decide('accepted')} onCancel={() => decide('declined')} cancelText="不用了" />
    </Card>
  );
}
