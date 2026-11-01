'use client';

import type { ReactNode } from 'react';
import { STEPS } from '@/config/steps';
import { useWorkspace } from '@/components/workspace/context';
import { AssetStep } from './asset-step';
import { InfoStep } from './info-step';
import { OutputStep } from './output-step';
import { PlanStep } from './plan-step';
import { StoryStep } from './story-step';

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
      {viewing === 'asset' && <AssetStep />}
      {viewing === 'info' && <InfoStep />}
      {viewing === 'story' && <StoryStep />}
      {viewing === 'plan' && <PlanStep />}
      {viewing === 'output' && <OutputStep />}
    </section>
  );
}

export function StepHead({ step, children }: { step: (typeof STEPS)[number]['id']; children?: ReactNode }) {
  const { current, setViewing, viewing } = useWorkspace();
  const name = STEPS.find((s) => s.id === step)!.name;
  return (
    <div className="mb-[18px] flex items-center gap-3">
      <h2 className="text-panel font-semibold">{name}</h2>
      {children}
      {viewing !== current && (
        <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={() => setViewing(null)}>
          回到当前这步
        </button>
      )}
    </div>
  );
}
