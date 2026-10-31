'use client';

import { useState } from 'react';
import { approveAndGenerate } from '@/client/generation';
import { approvalBlockers } from '@/domain/approval';
import { useWorkspace } from '@/components/workspace/context';

// 「批准并生成两张」：批准只能由用户在界面上操作产生（PRD 4.2 第 1 条），小间没有对应工具
export function ApproveButton({ className = '' }: { className?: string }) {
  const { ctx, workId } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const blockers = approvalBlockers(ctx.work, ctx.assets, ctx.basis, ctx.isGenerating);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button
        type="button"
        className="btn btn-primary self-start"
        disabled={pending || blockers.length > 0}
        onClick={async () => {
          setPending(true);
          setReasons([]);
          try {
            const r = await approveAndGenerate(workId);
            if (!r.ok) setReasons(r.reasons);
          } catch (e) {
            setReasons([e instanceof Error ? e.message : String(e)]);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? '正在提交…' : '批准并生成两张'}
      </button>
      {reasons.length > 0 && (
        <p role="alert" className="text-aux text-bad">
          没有生成：{reasons.join('；')}
        </p>
      )}
    </div>
  );
}
