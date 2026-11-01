'use client';

import Link from 'next/link';
import { use } from 'react';
import { browser } from 'react-dom';
import { useBlobFailed, useBlobUrl, useLibrary } from '@/client/hooks';
import type { WorkContext } from '@/client/work-store';
import { approvalStatus } from '@/domain/approval';
import { passed } from '@/domain/generation';
import type { Approval, Result } from '@/domain/types';
import { fmtTime } from '@/components/ui/format';
import { MissingImage } from '@/components/ui/missing-image';
import { EmptyState, PageFrame, PageLoading } from './page-frame';

const REAL = { none: '未验收', ok: '像', bad: '不像' } as const;
const STYLE = { none: '未验收', ok: '对', bad: '不对' } as const;

function ResultCard({ c, r, approval }: { c: WorkContext; r: Result; approval: Approval | undefined }) {
  const url = useBlobUrl(r.thumbId ?? r.blobId);
  const missing = useBlobFailed(r.thumbId ?? r.blobId);
  // 不是当前有效批准生成的那一轮，标「旧方案」（批准后又改过方案，或已经有更新的一轮）
  const current = approvalStatus(c.approval, c.snapshot).kind === 'valid' && c.approval?.usedRound === r.round;
  const meta = [`第 ${r.round} 轮`, `候选 ${r.slot + 1}`, approval ? `第 ${approval.version} 版方案` : null, approval?.snapshot.ratio, current ? null : '旧方案'];
  return (
    <Link href={`/works/${c.work.id}?step=output`} className="group flex min-w-0 flex-col gap-2 rounded-lg text-left" title="打开作品">
      <div
        className="relative overflow-hidden rounded-lg bg-soft transition-shadow duration-200 ease-soft group-hover:shadow-[0_0_0_1px_var(--color-line-strong),var(--shadow-md)]"
        style={{ aspectRatio: `${r.width} / ${r.height}` }}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的生成结果
          <img src={url} alt={`${c.work.name}，第 ${r.round} 轮候选 ${r.slot + 1}`} className="size-full object-cover" />
        )}
        {missing && <span className="absolute inset-0 grid place-items-center"><MissingImage /></span>}
        {passed(r) && <span className="chip chip-ok absolute left-1.5 top-1.5 shadow-sm">两项通过</span>}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5 text-label leading-normal text-muted">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="min-w-0 truncate text-body font-medium text-ink">{c.work.name}</h2>
          <span className="shrink-0 tabular-nums">{fmtTime(r.createdAt)}</span>
        </div>
        <span className="tabular-nums">{meta.filter(Boolean).join(' · ')}</span>
        <span className="text-aux text-ink-2">
          像实物 {REAL[r.verdict.real]} · 风格 {STYLE[r.verdict.style]}
          {r.issues.length > 0 && ` · 问题：${r.issues.join('、')}`}
          {r.exports.length > 0 && ' · 已导出'}
        </span>
      </div>
    </Link>
  );
}

// 历史结果（PRD 5.1、AC-10.3）：每张图的来源作品、方案版本、比例与验收；点图打开作品的出图步骤
export function HistoryPage() {
  use(browser('生成结果存在浏览器的本地数据库里'));
  const lib = useLibrary();
  if (!lib) return <PageLoading />;
  const approvals = new Map(lib.approvals.map((a) => [a.id, a]));
  const items = lib.works.flatMap((c) => c.results.map((r) => ({ c, r }))).sort((a, b) => b.r.createdAt - a.r.createdAt);

  return (
    <PageFrame title="历史结果">
      {items.length === 0 ? (
        <EmptyState title="还没有结果">在作品里批准方案、生成候选后，会出现在这里。</EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] items-start gap-x-4 gap-y-6">
          {items.map(({ c, r }) => (
            <ResultCard key={r.id} c={c} r={r} approval={approvals.get(r.approvalId)} />
          ))}
        </div>
      )}
    </PageFrame>
  );
}
