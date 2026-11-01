'use client';

import './globals.css';

// 根布局本身出错时的兜底：要自带 html 和 body
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <html lang="zh-CN" className="h-full">
      <body className="grid h-full place-items-center px-6">
        <div role="alert" className="flex max-w-[480px] flex-col items-center gap-3 text-center">
          <h1 className="text-panel font-semibold">一间出错了</h1>
          <p className="text-aux text-muted">作品数据存在这个浏览器里，不会因此丢失。请重试或刷新页面。</p>
          <p className="max-w-full break-words rounded-lg bg-canvas px-3 py-2 font-mono text-label text-ink-2">{message}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => retry()}>
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
