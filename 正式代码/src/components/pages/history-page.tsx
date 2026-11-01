'use client';

import { use, useState } from 'react';
import { browser } from 'react-dom';
import { useBlobUrl, useBlobUrls, useLibrary } from '@/client/hooks';
import type { WorkContext } from '@/client/work-store';
import { approvalStatus } from '@/domain/approval';
import { passed } from '@/domain/generation';
import type { Approval, Result } from '@/domain/types';
import { VERDICT_SHORT } from '@/config/verdict';
import { fmtTime } from '@/components/ui/format';
import Masonry, { type MasonryItem } from '@/components/bits/Masonry/Masonry';
import { EmptyState, PageFrame, PageLoading } from './page-frame';


type Entry = { c: WorkContext; r: Result; approval: Approval | undefined };

// 一张结果的来历：第几轮、第几版方案、比例、是否旧方案，以及验收（AC-10.3）
function describe({ c, r, approval }: Entry): string {
  // 不是当前有效批准生成的那一轮，标「旧方案」（批准后又改过方案，或已经有更新的一轮）
  const current = approvalStatus(c.approval, c.snapshot).kind === 'valid' && c.approval?.usedRound === r.round;
  const meta = [fmtTime(r.createdAt), `第 ${r.round} 轮候选 ${r.slot + 1}`, approval ? `第 ${approval.version} 版方案` : null, approval?.snapshot.ratio, current ? null : '旧方案'];
  const verdict = passed(r) ? '两项通过' : `像实物 ${VERDICT_SHORT.real[r.verdict.real]} · 风格 ${VERDICT_SHORT.style[r.verdict.style]}`;
  return [...meta, verdict, r.issues.length ? `问题：${r.issues.join('、')}` : null, r.exports.length ? '已导出' : null].filter(Boolean).join(' · ');
}

// 历史结果（PRD 5.1、AC-10.3）：瀑布流（React Bits Masonry），悬停看来历，点开大图，大图里可以打开作品的出图步骤
function ResultWall({ entries }: { entries: Entry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const thumbs = useBlobUrls(entries.map((e) => e.r.thumbId ?? e.r.blobId));
  const open = entries.find((e) => e.r.id === openId);
  // 大图用原图，打开时才读
  const full = useBlobUrl(open?.r.blobId);
  const items: MasonryItem[] = [];
  const missing: Entry[] = [];
  entries.forEach((e, i) => {
    if (thumbs.failed[i]) missing.push(e);
    const img = thumbs.urls[i];
    if (!img) return;
    items.push({
      id: e.r.id,
      img,
      full: e.r.id === openId ? (full ?? undefined) : undefined,
      width: e.r.width,
      height: e.r.height,
      title: e.c.work.name,
      description: describe(e),
      alt: `${e.c.work.name}，第 ${e.r.round} 轮候选 ${e.r.slot + 1}`,
      url: `/works/${e.c.work.id}?step=output`,
    });
  });
  return (
    <>
      {missing.length > 0 && (
        <p role="alert" className="mb-4 text-aux text-bad">
          有 {missing.length} 张图片在本地读不出来（可能清理过浏览器数据）：{missing.map((e) => `${e.c.work.name} 第 ${e.r.round} 轮候选 ${e.r.slot + 1}`).join('、')}
        </p>
      )}
      <Masonry
        items={items}
        columnWidth={200}
        gap={16}
        radius={10}
        hoverEffect="lift"
        captions="hover"
        draggable={false}
        openLabel="打开作品"
        onOpenChange={(item) => setOpenId(item ? String(item.id) : null)}
      />
    </>
  );
}

export function HistoryPage() {
  use(browser('生成结果存在浏览器的本地数据库里'));
  const lib = useLibrary();
  if (!lib) return <PageLoading />;
  const approvals = new Map(lib.approvals.map((a) => [a.id, a]));
  const entries = lib.works
    .flatMap((c) => c.results.map((r) => ({ c, r, approval: approvals.get(r.approvalId) })))
    .sort((a, b) => b.r.createdAt - a.r.createdAt);

  return (
    <PageFrame title="历史结果">
      {entries.length === 0 ? (
        <EmptyState title="还没有结果">在作品里批准方案、生成候选后，会出现在这里。</EmptyState>
      ) : (
        <ResultWall entries={entries} />
      )}
    </PageFrame>
  );
}
