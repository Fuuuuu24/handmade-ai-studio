'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { StepId } from '@/config/steps';
import { useAppConfig } from '@/client/hooks';
import type { WorkContext } from '@/client/work-store';
import { currentStep, stepStates } from '@/domain/status';
import { Canvas } from '@/components/canvas/canvas';
import { ChatPanel } from '@/components/chat/chat-panel';
import { WorkspaceProvider, type WorkspaceValue } from './context';
import { Topbar } from './topbar';

// 工作区：左对话（主）、右画布（当前步骤），顶栏细进度（PRD 5.1，照 v3 原型）
export function Workspace({ ctx }: { ctx: WorkContext }) {
  const { config, error: configError } = useAppConfig();
  const [picked, setPicked] = useState<StepId | null>(null);
  const [busy, setBusy] = useState(false);
  const sendRef = useRef<(text: string) => void>(() => undefined);

  const states = stepStates({
    work: ctx.work,
    assets: ctx.assets,
    tasks: ctx.tasks,
    results: ctx.results,
    approval: ctx.approval,
    current: ctx.snapshot,
  });
  const current = currentStep(states);
  const askAgent = useCallback((text: string) => sendRef.current(text), []);

  const value: WorkspaceValue = useMemo(
    () => ({
      workId: ctx.work.id,
      ctx,
      config,
      configError,
      viewing: picked ?? current,
      current,
      setViewing: setPicked,
      askAgent,
      busy,
    }),
    [ctx, config, configError, picked, current, askAgent, busy],
  );

  return (
    <WorkspaceProvider value={value}>
      <div className="flex h-full flex-col">
        <h1 className="sr-only">{ctx.work.name}</h1>
        <Topbar states={states} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,460px)_minmax(0,1fr)]">
          <ChatPanel
            registerSend={(fn) => {
              sendRef.current = fn;
            }}
            onBusyChange={setBusy}
            onShowStep={setPicked}
          />
          <Canvas />
        </div>
      </div>
    </WorkspaceProvider>
  );
}
