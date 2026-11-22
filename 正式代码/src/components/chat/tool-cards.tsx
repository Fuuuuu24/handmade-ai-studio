'use client';

import { useState, type ReactNode } from 'react';
import { VIEW_NAMES, type ViewAngle } from '@/config/views';
import { exportResult } from '@/client/export';
import { generateViews } from '@/client/generation';
import { mutateWork } from '@/client/work-store';
import { logEvent } from '@/data/repo';
import { anglesToGenerate, viewCheck } from '@/domain/assets';
import { passed } from '@/domain/generation';
import { decideProposal } from '@/domain/work';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/workspace/context';
import { useToast } from '@/components/ui/toast';
import { AI_NOTICE } from '@/components/canvas/result-step';

/* 小间放进对话的卡片：方向选卡、生成三视图的提议、下载。卡片只是入口，真正的生成和下载都由用户点按钮完成。 */

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-white p-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong),var(--shadow-sm)]">
      <strong className="text-body">{title}</strong>
      {children}
    </div>
  );
}

function Closed({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2.5 rounded-lg bg-canvas px-2.5 py-2 text-aux text-ink-2">{children}</div>;
}

// 「我不知道」时的方向卡片（AC-04.2）：点一张就把选择发给小间
export function PicksCard({ input, active }: { input: { question?: string; options: { title: string; reason: string }[] }; active: boolean }) {
  const { askAgent, busy, workId } = useWorkspace();
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
            onClick={() => {
              void logEvent('picks', workId, { options: input.options.length });
              askAgent(`我选「${o.title}」`);
            }}
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

// 生成三视图的提议（PRD AC-02.3、4.2 第 1 条）：小间只能提议，用户点了才生成；点过的卡片记下决定（Work.proposals）
export function ViewsCard({ toolCallId, input, active }: { toolCallId: string; input: { angles?: ViewAngle[]; note?: string }; active: boolean }) {
  const { ctx, workId, setViewing } = useWorkspace();
  const [problem, setProblem] = useState<string | null>(null);
  const decision = ctx.work.proposals?.[toolCallId];
  const angles = input.angles?.length ? input.angles : anglesToGenerate(ctx.assets, ctx.tasks, workId);
  const names = angles.map((a) => VIEW_NAMES[a]).join('、');
  const look = (
    <button type="button" className="mini-btn ml-auto" onClick={() => setViewing('product')}>
      看商品
    </button>
  );
  if (decision) {
    return (
      <Closed>
        <span className="min-w-0 flex-1">{decision === 'accepted' ? '已开始生成三视图，出来后到「商品」里逐张对照确认' : '没有生成三视图'}</span>
        {look}
      </Closed>
    );
  }
  if (!active) {
    return (
      <Closed>
        <span className="min-w-0 flex-1">生成三视图的提议（未处理）</span>
        {look}
      </Closed>
    );
  }
  const check = viewCheck(ctx.assets, ctx.tasks, workId, angles, ctx.busy);
  return (
    <Card title="生成三视图？">
      <p className="text-aux text-ink-2">{input.note ?? `按${names || '三个角度'}照片各生成一张白底图，出来后逐张对照原图确认；合成只用三视图。`}</p>
      {!check.ok && <p className="text-aux text-warn">{check.reason}</p>}
      {problem && <p className="text-aux text-warn">{problem}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!check.ok}
          onClick={async () => {
            setProblem(null);
            const r = await generateViews(workId, input.angles?.length ? input.angles : undefined);
            if (!r.ok) return setProblem(r.reason);
            await mutateWork(workId, (c) => decideProposal(c.work, toolCallId, 'accepted'));
          }}
        >
          生成{angles.length ? ` ${angles.length} 张` : ''}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void mutateWork(workId, (c) => decideProposal(c.work, toolCallId, 'declined'))}>
          不用了
        </button>
        <span className="text-label text-muted">每张要花一张图的钱</span>
      </div>
    </Card>
  );
}

export function ExportCard({ round, candidate }: { round: number; candidate: number }) {
  const { ctx } = useWorkspace();
  const toast = useToast();
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
          className="mini-btn inline-flex items-center gap-1"
          disabled={!ok}
          title={ok ? undefined : '两项都验收满意后才能导出'}
          onClick={async () => {
            setProblem(null);
            const r = await exportResult(ctx.work.name, result);
            if (!r.ok) setProblem(r.reason);
            else toast('已开始下载', `第 ${result.round} 轮候选 ${result.slot + 1}，原图`);
          }}
        >
          <Icon name="download" className="size-3.5" />
          下载
        </button>
      </div>
      <p className="text-label text-muted">{AI_NOTICE}</p>
      {problem && <p className="text-bad">没有导出：{problem}</p>}
    </div>
  );
}
