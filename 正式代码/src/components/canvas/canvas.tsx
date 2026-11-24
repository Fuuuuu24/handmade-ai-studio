'use client';

import { useState, type ReactNode } from 'react';
import { STEP_NAMES, type StepId } from '@/config/steps';
import { mutateWork } from '@/client/work-store';
import { handoffBlocker, nextStepOf, type HandoffStep } from '@/domain/handoff';
import { queueHandoff } from '@/domain/work';
import { useWorkspace } from '@/components/workspace/context';
import { BackdropStep } from './backdrop-step';
import { InfoStep } from './info-step';
import { PlacementStep } from './placement-step';
import { ProductStep } from './product-step';
import { ResultStep } from './result-step';

const isTextEntry = (el: EventTarget) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button'].includes(el.type));

// 右侧画布：显示正在看的那一步，可直接修改（PRD 5.1）；点顶栏进度可以看任一步。
// 在画布里输入文字时停在这一步：填完必填项不会马上跳走，选填的「不能改的细节」等还能接着填
export function Canvas() {
  const { viewing, current, setViewing } = useWorkspace();
  return (
    <section
      aria-label="画布"
      className="min-h-0 overflow-y-auto bg-canvas px-9 pb-10 pt-[22px]"
      onFocusCapture={(e) => {
        if (viewing === current && isTextEntry(e.target)) setViewing(viewing);
      }}
    >
      {viewing === 'product' && <ProductStep />}
      {viewing === 'info' && <InfoStep />}
      {viewing === 'backdrop' && <BackdropStep />}
      {viewing === 'placement' && <PlacementStep />}
      {viewing === 'result' && <ResultStep />}
    </section>
  );
}

export function StepHead({ step, children }: { step: StepId; children?: ReactNode }) {
  const { current, setViewing, viewing } = useWorkspace();
  return (
    <div className="mb-[18px] flex items-center gap-3">
      <h2 className="text-panel font-semibold">{STEP_NAMES[step]}</h2>
      {children}
      {viewing !== current && (
        <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={() => setViewing(null)}>
          回到当前这步
        </button>
      )}
    </div>
  );
}

// 「下一步」（PRD AC-11.3a，技术写法 13.12）：这一步做完才能点，不能点时写明缺什么。点了：先让正在输入的框失焦保存，
// 画布切到下一步，再排一个交接，对话空闲时把这一页的内容整理好发给小间
export function NextStep({ step }: { step: HandoffStep }) {
  const { ctx, workId, setViewing } = useWorkspace();
  const [problem, setProblem] = useState<string | null>(null);
  const next = nextStepOf(ctx.work.flow, step);
  if (!next) return null;
  const reason = handoffBlocker(ctx, step);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      <button
        type="button"
        className="btn btn-primary"
        disabled={!!reason}
        onClick={async () => {
          setProblem(null);
          (document.activeElement as HTMLElement | null)?.blur();
          setViewing(next);
          await mutateWork(workId, (c) => queueHandoff(c.work, step)).catch((e: unknown) => setProblem(`没交接上：${e instanceof Error ? e.message : String(e)}`));
        }}
      >
        下一步：{STEP_NAMES[next]}
      </button>
      <span className="text-aux text-muted">{reason ?? '小间会先说说它对这一页的理解，再说接下来做什么'}</span>
      {problem && (
        <span role="alert" className="text-aux text-bad">
          {problem}
        </span>
      )}
    </div>
  );
}
