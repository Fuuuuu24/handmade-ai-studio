'use client';

import { useState } from 'react';
import { approveAndGenerate } from '@/client/generation';
import { approvalBlockers } from '@/domain/approval';
import SlideCommit from '@/components/bits/SlideCommit/SlideCommit';
import { useWorkspace } from '@/components/workspace/context';

// 「批准并生成两张」（React Bits Slide Commit）：滑到底才批准，避免误点花钱；键盘按 End 也可以。
// 批准只能由用户在界面上操作产生（PRD 4.2 第 1 条），小间没有对应工具
export function ApproveButton({ className = '' }: { className?: string }) {
  const { ctx, workId, setViewing } = useWorkspace();
  const [reasons, setReasons] = useState<string[]>([]);
  const blockers = approvalBlockers(ctx.work, ctx.assets, ctx.basis, ctx.isGenerating);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <SlideCommit
        width={248}
        height={40}
        label="滑动批准并生成两张"
        doneLabel="已批准"
        errorLabel="没有生成"
        disabled={blockers.length > 0}
        onConfirm={async () => {
          setReasons([]);
          const r = await approveAndGenerate(workId).catch((e: unknown) => ({ ok: false as const, reasons: [e instanceof Error ? e.message : String(e)] }));
          if (!r.ok) {
            setReasons(r.reasons);
            throw new Error(r.reasons.join('；'));
          }
          // 切到出图看生成进度（对话里的批准卡片批准后马上收起，不能等动画结束）。直接指定出图：
          // 信息里还有没处理的建议时，「当前该做的一步」会停在信息（BC-002）
          setViewing('output');
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
