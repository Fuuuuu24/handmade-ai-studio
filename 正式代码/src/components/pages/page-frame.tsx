import type { ReactNode } from 'react';

// 作品、我的风格、摄影布景、历史结果共用的页面框架：内容最宽 1160px，标题 20px 常规字重（沿用 v2／v3）
export function PageFrame({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1160px] px-8 pb-12 pt-10">
        <header className="mb-7 flex flex-col gap-1.5">
          <h1 className="text-page font-normal tracking-[0.01em]">{title}</h1>
          {intro && <p className="max-w-[560px] text-aux text-muted">{intro}</p>}
        </header>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-16 text-center">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children && <p className="max-w-[420px] text-aux text-muted">{children}</p>}
      {actions && <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function PageLoading() {
  return <div className="grid min-h-0 flex-1 place-items-center text-aux text-muted">正在读取…</div>;
}
