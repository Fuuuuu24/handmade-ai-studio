'use client';

import { createContext, useContext } from 'react';
import type { StepId } from '@/config/steps';
import type { AppConfig } from '@/client/api';
import type { WorkContext } from '@/client/work-store';

// 工作区共享的数据：对话和画布读同一份作品状态（PRD FR-05：聊天与卡片是同一份数据）
export interface WorkspaceValue {
  workId: string;
  ctx: WorkContext;
  config: AppConfig | null;
  configError: string | null;
  viewing: StepId;
  current: StepId;
  setViewing: (step: StepId | null) => void; // null：跟着当前该做的一步走
  askAgent: (text: string) => void; // 画布上的「让小间……」按钮通过它发消息
  busy: boolean; // 小间正在回复
}

const WorkspaceCtx = createContext<WorkspaceValue | null>(null);

export const WorkspaceProvider = WorkspaceCtx.Provider;

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceCtx);
  if (!v) throw new Error('useWorkspace 只能在工作区里使用');
  return v;
}
