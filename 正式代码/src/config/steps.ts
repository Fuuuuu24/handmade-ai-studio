// 顶栏细进度的五步。步骤名是否改得更口语，待发起人决定（交接文档第 4 节），改这里即可。
export const STEPS = [
  { id: 'asset', name: '资产' },
  { id: 'info', name: '信息' },
  { id: 'story', name: '共创' },
  { id: 'plan', name: '方案' },
  { id: 'output', name: '出图' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];
