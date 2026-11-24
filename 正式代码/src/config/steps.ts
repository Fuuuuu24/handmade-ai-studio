// 两套流程（PRD 5.2、技术写法 13.2）：五步的内容一样，只是位置不同；顶栏细进度按这件作品的流程排。
// 步骤用编号，不用序号：同一步在两套流程里位置不同
export const STEP_NAMES = {
  product: '商品',
  info: '信息',
  backdrop: '背景',
  placement: '摆放',
  result: '出图',
} as const;

export type StepId = keyof typeof STEP_NAMES;

export const STEP_IDS = ['product', 'info', 'backdrop', 'placement', 'result'] as const satisfies readonly StepId[];

// home：首页开始（流程一）；template：套用模板库里的背景图（流程二）
export type Flow = 'home' | 'template';

export const FLOW_STEPS: Record<Flow, readonly StepId[]> = {
  home: ['product', 'info', 'backdrop', 'placement', 'result'],
  template: ['backdrop', 'product', 'info', 'placement', 'result'],
};

export const FLOW_NAMES: Record<Flow, string> = { home: '首页开始', template: '套用模板' };

export const stepsOf = (flow: Flow) => FLOW_STEPS[flow].map((id) => ({ id, name: STEP_NAMES[id] }));

export const isStepId = (v: unknown): v is StepId => typeof v === 'string' && (STEP_IDS as readonly string[]).includes(v);
