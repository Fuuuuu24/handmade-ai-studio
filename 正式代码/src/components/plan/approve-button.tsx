'use client';

import { useState } from 'react';
import { approveAndGenerate, approveAndGenerateBackdrop } from '@/client/generation';
import { backdropApprovalBlockers, sceneApprovalBlockers } from '@/domain/approval';
import type { PromptKind } from '@/domain/types';
import SlideCommit from '@/components/bits/SlideCommit/SlideCommit';
import { useWorkspace } from '@/components/workspace/context';

// 「批准并生成两张」（React Bits Slide Commit）：滑到底才批准，避免误点花钱；键盘按 End 也可以。
// 批准只能由用户在界面上操作产生（PRD 4.2 第 1 条），小间没有对应工具。背景、合成各一种（技术写法 13.4、13.5）
export function ApproveButton({ kind, className = '' }: { kind: PromptKind; className?: string }) {
  const { ctx, workId, setViewing } = useWorkspace();
  const [reasons, setReasons] = useState<string[]>([]);
  const blockers = kind === 'backdrop' ? backdropApprovalBlockers(ctx) : sceneApprovalBlockers(ctx);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <SlideCommit
        width={kind === 'backdrop' ? 268 : 248}
        height={40}
        label={kind === 'backdrop' ? '滑动批准并生成两张背景' : '滑动批准并生成两张'}
        doneLabel="已批准"
        errorLabel="没有生成"
        disabled={blockers.length > 0}
        onConfirm={async () => {
          setReasons([]);
          const run = kind === 'backdrop' ? approveAndGenerateBackdrop : approveAndGenerate;
          const r = await run(workId).catch((e: unknown) => ({ ok: false as const, reasons: [e instanceof Error ? e.message : String(e)] }));
          if (!r.ok) {
            setReasons(r.reasons);
            throw new Error(r.reasons.join('；'));
          }
          // 背景：留在背景这一步等两张出来选一张；合成：切到出图看进度（对话里的批准卡片批准后马上收起，不能等动画结束）
          setViewing(kind === 'backdrop' ? 'backdrop' : 'result');
        }}
      />
      {reasons.length > 0 && (
        <p role="alert" className="text-aux text-bad">
          没有生成：{reasons.join('；')}
        </p>
      )}
    </div>
  );
}
