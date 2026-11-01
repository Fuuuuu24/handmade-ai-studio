// 风格卡维度（PRD FR-05）。选项只是常用说法，小间和用户都可以写选项以外的描述。
export const STYLE_KEYS = ['tone', 'background', 'light', 'placement', 'props', 'banned', 'composition', 'expression'] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

export const STYLE_LABELS: Record<StyleKey, string> = {
  tone: '色调',
  background: '背景',
  light: '光线',
  placement: '摆放',
  props: '道具',
  banned: '禁止出现',
  composition: '构图',
  expression: '表达',
};

// 选齐这几项才能批准；道具、禁止出现、表达可以留空
export const STYLE_REQUIRED = ['tone', 'background', 'light', 'placement', 'composition'] as const satisfies readonly StyleKey[];

// 道具留空时显示的说法
export const NO_PROPS = '不放道具';

export const TONE_OPTIONS = [
  { name: '雨后苔绿', desc: '低饱和绿，偏冷', colors: ['#dfe4d5', '#b9c4a6', '#7e8f6c'] },
  { name: '奶油米白', desc: '暖白，柔和', colors: ['#f3ede2', '#e6dac6', '#c9b79a'] },
  { name: '石灰浅灰', desc: '中性灰，干净', colors: ['#ecebe8', '#d5d3ce', '#a8a49d'] },
  { name: '干燥玫瑰', desc: '灰调粉，温柔', colors: ['#efe3e1', '#ddc5c1', '#b8928c'] },
  { name: '深墨对比', desc: '深色底，高对比', colors: ['#3a3a38', '#2a2a28', '#8d8a82'] },
] as const;

export const STYLE_OPTIONS: Partial<Record<StyleKey, readonly string[]>> = {
  tone: TONE_OPTIONS.map((t) => t.name),
  background: ['手工纸', '亚麻布', '原木', '石材', '纯色背景'],
  light: ['柔和自然光', '窗边侧光', '暖调午后光', '清冷晨光', '明暗对比光'],
  placement: ['平铺', '悬挂', '支架'],
  composition: ['主体居中，留白多', '主体偏一侧，留出呼吸感', '主体放大，突出细节'],
};

export const toneColors = (tone: string): readonly string[] | null =>
  TONE_OPTIONS.find((t) => tone.includes(t.name))?.colors ?? null;
