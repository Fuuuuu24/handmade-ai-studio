'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// 页面出错时的兜底（PRD 7.3：失败要说明原因、可以重试）。作品数据存在浏览器本地，出错不会丢
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="grid h-full place-items-center px-6">
      <div role="alert" className="flex max-w-[480px] flex-col items-center gap-3 text-center">
        <h1 className="text-panel font-semibold">这个页面出错了</h1>
        <p className="text-aux text-muted">已经保存的作品不受影响。可以重试，或回到作品列表。</p>
        <p className="max-w-full break-words rounded-lg bg-canvas px-3 py-2 font-mono text-label text-ink-2">{message}</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => retry()}>
            重试
          </button>
          <Link href="/works" className="btn btn-outline btn-sm">
            回到作品
          </Link>
        </div>
      </div>
    </div>
  );
}
