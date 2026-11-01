// 验收时可以指出的问题（PRD AC-09.2）
export const ISSUES = {
  real: ['颜色', '数量', '轮廓', '连接结构', '纹样', '材质'],
  style: ['背景', '光线', '道具', '构图'],
} as const;

export const VERDICT_TEXT = {
  real: { none: '未验收', ok: '像实物', bad: '不像' },
  style: { none: '未验收', ok: '风格对', bad: '不对' },
} as const;

// 列表里并排显示两项时用的短说法：「像实物 像 · 风格 对」
export const VERDICT_SHORT = {
  real: { none: '未验收', ok: '像', bad: '不像' },
  style: { none: '未验收', ok: '对', bad: '不对' },
} as const;
