'use client';

import Link from 'next/link';
import { use } from 'react';
import { browser } from 'react-dom';
import { useBlobUrl, useLibrary } from '@/client/hooks';
import type { WorkContext } from '@/client/work-store';
import { passed } from '@/domain/generation';
import { activeUploads } from '@/domain/snapshot';
import { workStatus } from '@/domain/status';
import { fmtTime } from '@/components/ui/format';
import { Icon } from '@/components/ui/icon';
import { StatusChip } from '@/components/ui/status-chip';
import { EmptyState, PageFrame, PageLoading } from './page-frame';

// 封面：最近一张两项都满意的结果，其次最近一张结果，再其次整体照（沿用 v3）
function coverOf(c: WorkContext): string | null {
  const results = [...c.results].sort((a, b) => b.createdAt - a.createdAt);
  const result = results.find(passed) ?? results[0];
  if (result) return result.thumbId ?? result.blobId;
  return activeUploads(c.assets, c.work.id)[0]?.thumbId ?? null;
}

function WorkCard({ c }: { c: WorkContext }) {
  const url = useBlobUrl(coverOf(c));
  const status = workStatus({ work: c.work, assets: c.assets, tasks: c.tasks, results: c.results, approval: c.approval, current: c.snapshot });
  return (
    <Link href={`/works/${c.work.id}`} className="group flex min-w-0 flex-col gap-2.5 rounded-lg text-left">
      <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-soft transition-shadow duration-200 ease-soft group-hover:shadow-[0_0_0_1px_var(--color-line-strong),var(--shadow-md)]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的图片
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden="true" className="text-[24px] text-faint">
            间
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-0.5">
        <h2 className="truncate text-body font-medium leading-snug">{c.work.name}</h2>
        <div className="flex items-center justify-between gap-2">
          <StatusChip text={status.text} tone={status.tone} />
          <span className="text-label tabular-nums text-muted">{fmtTime(c.work.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

// 作品（PRD FR-01、AC-01.1）：名称、封面和当前进度；打开后恢复对应内容
export function WorksPage() {
  use(browser('作品数据存在浏览器的本地数据库里'));
  const lib = useLibrary();
  if (!lib) return <PageLoading />;
  return (
    <PageFrame title="作品">
      {lib.works.length === 0 ? (
        <EmptyState
          title="还没有作品"
          actions={
            <Link href="/" className="btn btn-primary">
              新建作品
            </Link>
          }
        >
          在首页上传一件作品的照片、说一句话就能开始。
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-x-4 gap-y-7">
          {lib.works.map((c) => (
            <WorkCard key={c.work.id} c={c} />
          ))}
          <Link
            href="/"
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg bg-canvas text-aux text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-soft hover:text-ink"
          >
            <span className="grid size-7 place-items-center rounded-full bg-black text-white">
              <Icon name="plus" className="size-[15px]" />
            </span>
            新建作品
          </Link>
        </div>
      )}
    </PageFrame>
  );
}
