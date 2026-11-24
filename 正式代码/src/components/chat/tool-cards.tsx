'use client';

import { useState, type ReactNode } from 'react';
import type { StepId } from '@/config/steps';
import { VIEW_NAMES, type ViewAngle } from '@/config/views';
import { exportResult } from '@/client/export';
import { generateViews, retrySlot } from '@/client/generation';
import { useBlobUrl } from '@/client/hooks';
import { mutateWork } from '@/client/work-store';
import { logEvent } from '@/data/repo';
import { anglesToGenerate, viewCheck } from '@/domain/assets';
import { lastSlotTask, passed, retryCheck } from '@/domain/generation';
import type { AskItem } from '@/domain/types';
import { decideProposal } from '@/domain/work';
import { AngleCompare } from '@/components/canvas/product-step';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/workspace/context';
import { useToast } from '@/components/ui/toast';
import { AI_NOTICE } from '@/components/canvas/result-step';

/* 小间放进对话的卡片：方向选卡、生成三视图和补齐的提议、下载、「要我替你点吗」。卡片只是入口：生成、补齐和下载由用户点按钮完成；
   「要我替你点吗」的按钮等于替用户打「同意」「不用了」发出去，代点只经小间的 confirm_for_user（技术写法 14.4）。 */

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

// 补齐失败的一张（技术写法 14.6）：小间只能放卡片，用户点了才补；能不能补和画布上的按钮同一个条件（retryCheck，批准是否仍有效在 retrySlot 里查）
export function RetryCard({ toolCallId, input, active }: { toolCallId: string; input: { kind: 'backdrop' | 'scene'; round: number; candidate: number }; active: boolean }) {
  const { ctx, workId, setViewing } = useWorkspace();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { kind, round, candidate } = input;
  const slot = candidate - 1;
  const what = `第 ${round} 轮${kind === 'backdrop' ? '背景' : '候选'} ${candidate}`;
  const decision = ctx.work.proposals?.[toolCallId];
  const look = (
    <button type="button" className="mini-btn ml-auto" onClick={() => setViewing(kind === 'backdrop' ? 'backdrop' : 'result')}>
      {kind === 'backdrop' ? '看背景' : '看结果'}
    </button>
  );
  if (decision || !active) {
    return (
      <Closed>
        <span className="min-w-0 flex-1">{decision === 'accepted' ? `已重新提交${what}` : decision === 'declined' ? `没有补齐${what}` : `补齐${what}的提议（未处理）`}</span>
        {look}
      </Closed>
    );
  }
  const check = retryCheck(ctx.tasks, workId, kind, round, slot);
  const error = lastSlotTask(ctx.tasks, workId, kind, round, slot)?.error;
  return (
    <Card title="补齐这一张？">
      <p className="text-aux text-ink-2">
        {what}没有生成出来{error ? `：${error}` : ''}。按批准时的方案再生成这一张。
      </p>
      {!check.ok && <p className="text-aux text-warn">现在不能补齐：{check.reason}</p>}
      {problem && <p className="text-aux text-warn">{problem}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!check.ok || pending}
          onClick={async () => {
            setProblem(null);
            setPending(true);
            const r = await retrySlot(workId, kind, round, slot);
            setPending(false);
            if (!r.ok) return setProblem(`没有补齐：${r.reasons.join('；')}`);
            await mutateWork(workId, (c) => decideProposal(c.work, toolCallId, 'accepted'));
          }}
        >
          {pending ? '提交中…' : '补齐这一张'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void mutateWork(workId, (c) => decideProposal(c.work, toolCallId, 'declined'))}>
          不用了
        </button>
        <span className="text-label text-muted">要花一张图的钱</span>
      </div>
    </Card>
  );
}

// 卡片上每一样旁边的入口：三视图打开对照弹窗，背景看大图，其余切到画布上那一步
const ITEM_STEP: Record<AskItem['action']['type'], StepId> = {
  confirm_view: 'product',
  accept_info: 'info',
  mark_unknown: 'info',
  confirm_summary: 'backdrop',
  pick_backdrop: 'backdrop',
  save_backdrop: 'backdrop',
  verdict: 'result',
  switch_flow: 'backdrop',
};

function BackdropLink({ id }: { id: string }) {
  const { ctx } = useWorkspace();
  const b = ctx.backdrops.find((x) => x.id === id);
  const url = useBlobUrl(b?.blobId);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mini-btn">
      看大图
    </a>
  );
}

function ItemLook({ item }: { item: AskItem }) {
  const { setViewing } = useWorkspace();
  const [open, setOpen] = useState(false);
  const a = item.action;
  if (a.type === 'confirm_view') {
    return (
      <>
        <button type="button" className="mini-btn" onClick={() => setOpen(true)}>
          对照
        </button>
        <AngleCompare angle={a.angle} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  if ((a.type === 'pick_backdrop' || a.type === 'save_backdrop') && item.target) return <BackdropLink id={item.target} />;
  return (
    <button type="button" className="mini-btn" onClick={() => setViewing(ITEM_STEP[a.type])}>
      看画布
    </button>
  );
}

// 「要我替你点吗」（技术写法 14.4）：列出小间要替用户点的几样。「同意」「不用了」等于替用户在输入框里打这两个字发出去，
// 不直接执行；用户同意后由小间代点，代码核对原话和东西有没有变。卡片按作品上记的请求显示结果
export function AskCard({ toolCallId, active }: { toolCallId: string; active: boolean }) {
  const { ctx, askAgent, busy } = useWorkspace();
  const ask = ctx.work.asks?.[toolCallId];
  if (!ask) return <Closed>这次请求找不到了</Closed>;
  if (ask.state === 'done') {
    const done = new Set(ask.done ?? []);
    const left = ask.items.length - done.size;
    return (
      <Closed>
        <span className="min-w-0 flex-1">
          替你点了：{ask.items.filter((_, i) => done.has(i)).map((it) => it.text).join('；')}（你说「{ask.quote}」）{left ? `；其余 ${left} 样没点` : ''}
        </span>
      </Closed>
    );
  }
  if (ask.state === 'expired') return <Closed>没有代点：{ask.reason ?? '问过之后东西变了'}</Closed>;
  if (ask.state === 'replaced') return <Closed>没有代点：小间又问了新的</Closed>;
  const pick = ask.items.some((it) => it.action.type === 'pick_backdrop' || it.action.type === 'save_backdrop');
  return (
    <Card title="要我替你点吗？">
      <ol className="flex flex-col gap-1.5 text-aux text-ink-2">
        {ask.items.map((it, n) => (
          <li key={n} className="flex items-start gap-2">
            <span className="w-4 shrink-0 text-right tabular-nums text-muted">{n + 1}.</span>
            <span className="min-w-0 flex-1">{it.text}</span>
            <ItemLook item={it} />
          </li>
        ))}
      </ol>
      {pick && <p className="text-label text-muted">图里不能有饰品，请先看一眼</p>}
      {active ? (
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => askAgent('同意')}>
            同意
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => askAgent('不用了')}>
            不用了
          </button>
          <span className="text-label text-muted">也可以直接打字，比如只同意其中几样</span>
        </div>
      ) : (
        <p className="text-label text-muted">还没代点</p>
      )}
    </Card>
  );
}
