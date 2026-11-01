'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { STEPS, type StepId } from '@/config/steps';
import { mutateWork } from '@/client/work-store';
import { deleteWork, logEvent } from '@/data/repo';
import { workStatus, type StepState } from '@/domain/status';
import { renameWork } from '@/domain/work';
import { useConfirm } from '@/components/ui/dialog';
import { DraftInput } from '@/components/ui/draft-field';
import { Icon } from '@/components/ui/icon';
import { StatusChip } from '@/components/ui/status-chip';
import { SaveStatusText } from './save-status';
import { useWorkspace } from './context';

// 顶栏：作品 / 名称（可直接改）· 状态，右侧细进度（v3 原型）
// 删除作品（PRD 4.2 第 5 条）：用户确认后才删；生成中不能删，避免轮询把结果写回已删除的作品
function DeleteWork() {
  const { ctx, workId } = useWorkspace();
  const confirm = useConfirm();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const locked = ctx.isGenerating || ctx.isMakingWhite;
  return (
    <>
      {problem && (
        <span role="alert" className="ml-2 text-aux text-bad">
          {problem}
        </span>
      )}
      <button
        type="button"
        className="icon-btn ml-1"
        aria-label="删除作品"
        title={locked ? '正在生成，等结束后再删' : '删除作品'}
        disabled={locked}
        onClick={async () => {
          const ok = await confirm({
            title: `删除「${ctx.work.name}」？`,
            body: '照片、对话、方案和生成结果会一起删除，不能恢复。',
            ok: '删除',
            danger: true,
          });
          if (!ok) return;
          try {
            const cost = ctx.work.costUSD;
            await deleteWork(workId);
            // 试用记录：作品删了，花费仍要算进总成本
            void logEvent('delete_work', undefined, { costUSD: cost });
            router.push('/works');
          } catch (e) {
            setProblem(`没有删掉：${e instanceof Error ? e.message : String(e)}`);
          }
        }}
      >
        <Icon name="trash" />
      </button>
    </>
  );
}

// 服务状态（AC-08.6）：开发用的假网关、或服务端没配密钥时明确标出，不把测试图当 AI 生成
function ServiceNote() {
  const { config } = useWorkspace();
  if (config?.fake) {
    return (
      <span className="chip chip-warn ml-2" title="开发用的假生图网关：生成的是测试图，不调用模型、不花钱">
        测试网关 · 图片非 AI 生成
      </span>
    );
  }
  if (config && !config.configured) {
    return <span className="chip chip-bad ml-2">模型服务未配置</span>;
  }
  // 试用操作员看得到预算余量（打开页面时读的数，不实时刷新）
  if (config?.operator) {
    return (
      <span className="ml-2 text-label text-muted" title="服务端花费账本，打开页面时读取">
        预算余 {config.budget.remainingUSD.toFixed(2)} / {config.budget.totalUSD} 美元
      </span>
    );
  }
  return null;
}

export function Topbar({ states }: { states: Record<StepId, StepState> }) {
  const { ctx, viewing, current, setViewing, workId } = useWorkspace();
  const status = workStatus({
    work: ctx.work,
    assets: ctx.assets,
    tasks: ctx.tasks,
    results: ctx.results,
    approval: ctx.approval,
    current: ctx.snapshot,
  });
  useEffect(() => {
    document.title = `${ctx.work.name} · 一间`;
  }, [ctx.work.name]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-4 pl-5 shadow-[0_1px_0_var(--color-line)]">
      <nav aria-label="位置" className="flex min-w-0 items-center gap-1 text-body text-muted">
        <Link href="/works" className="-ml-1.5 rounded-md px-1.5 py-0.5 hover:bg-soft hover:text-ink">
          作品
        </Link>
        <span className="text-faint">/</span>
        <DraftInput
          aria-label="作品名称"
          name="work-name"
          className="h-7 min-w-12 max-w-[26ch] rounded-md bg-transparent px-1.5 text-body font-medium text-ink [field-sizing:content] hover:bg-soft focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-ring)] focus:outline-none"
          value={ctx.work.name}
          onCommit={(v) => v.trim() && void mutateWork(workId, (c) => renameWork(c.work, v))}
        />
        <StatusChip text={status.text} tone={status.tone} className="ml-1" />
      </nav>
      <SaveStatusText />
      <ServiceNote />
      <nav aria-label="流程进度" className="ml-auto flex items-center gap-0.5">
        {STEPS.map((s) => {
          const st = states[s.id];
          const isCurrent = s.id === current;
          const isViewing = s.id === viewing;
          return (
            <button
              key={s.id}
              type="button"
              aria-current={isViewing ? 'step' : undefined}
              onClick={() => setViewing(s.id === current ? null : s.id)}
              className={`inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-aux transition-colors hover:bg-soft hover:text-ink ${
                isViewing ? 'bg-fill font-medium text-ink' : isCurrent ? 'text-ink' : 'text-muted'
              }`}
            >
              <i
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  isCurrent
                    ? 'bg-accent shadow-[0_0_0_3px_var(--color-accent-ring)]'
                    : st === 'done'
                      ? 'bg-ink-2'
                      : st === 'stale'
                        ? 'bg-warn'
                        : 'shadow-[inset_0_0_0_1.2px_var(--color-faint)]'
                }`}
              />
              {s.name}
              <span className="sr-only">{st === 'done' ? '（完成）' : st === 'stale' ? '（已失效）' : isCurrent ? '（当前）' : ''}</span>
            </button>
          );
        })}
      </nav>
      <DeleteWork />
    </header>
  );
}
