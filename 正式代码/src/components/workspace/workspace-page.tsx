'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { use, useEffect } from 'react';
import { browser } from 'react-dom';
import { STEPS } from '@/config/steps';
import { resumeActiveTasks } from '@/client/generation';
import { useWorkContext } from '@/client/hooks';
import { Workspace } from './workspace';

export function WorkspacePage() {
  use(browser('作品数据存在浏览器的本地数据库里'));
  const { id } = useParams<{ id: string }>();
  // 历史结果点图进来时带 ?step=output，画布先显示那一步
  const step = useSearchParams().get('step');
  const initialStep = STEPS.find((s) => s.id === step)?.id ?? null;
  const ctx = useWorkContext(id);
  useEffect(() => {
    void resumeActiveTasks().catch((e) => console.error('恢复生成任务失败', e));
  }, []);

  if (ctx === null) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-block text-ink-2">这件作品不存在，可能已经删除，或保存在另一个浏览器里</p>
          <Link href="/" className="btn btn-outline btn-sm">
            回到首页
          </Link>
        </div>
      </div>
    );
  }
  if (ctx === undefined) {
    return <div className="grid h-full place-items-center text-aux text-muted">正在打开作品…</div>;
  }
  return <Workspace key={id} ctx={ctx} initialStep={initialStep} />;
}
