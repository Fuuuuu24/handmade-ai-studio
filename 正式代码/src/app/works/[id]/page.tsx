import { Suspense } from 'react';
import { WorkspacePage } from '@/components/workspace/workspace-page';

// 作品数据只存在用户浏览器里（PRD O5），页面在浏览器里渲染；构建时只输出加载占位
export default function Page() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-aux text-muted">正在打开作品…</div>}>
      <WorkspacePage />
    </Suspense>
  );
}
