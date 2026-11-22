// 风格卡维度（PRD FR-05，v0.6 拆成背景、摆放两张卡）。选项只是常用说法，小间和用户都可以写选项以外的描述。
// 归背景的五项写进背景提示词，背景图选定后以背景图记录的参数为准、只读；归摆放的三项每件作品自己定。「表达」已删除
export const BACKDROP_KEYS = ['tone', 'background', 'light', 'props', 'bannedBackdrop'] as const;
export const SCENE_KEYS = ['placement', 'composition', 'bannedScene'] as const;
export const STYLE_KEYS = [...BACKDROP_KEYS, ...SCENE_KEYS] as const;

export type BackdropKey = (typeof BACKDROP_KEYS)[number];
export type SceneKey = (typeof SCENE_KEYS)[number];
export type StyleKey = (typeof STYLE_KEYS)[number];

// 给小间和改动说明用的全称：两张卡各有一项「禁止出现」，要分得开
export const STYLE_LABELS: Record<StyleKey, string> = {
  tone: '色调',
  background: '背景',
  light: '光线',
  props: '装饰道具',
  bannedBackdrop: '背景禁止项',
  placement: '摆放',
  composition: '构图',
  bannedScene: '合成禁止项',
};

// 卡片上的短名：已经在「背景」「摆放」卡里，不用再写是哪边的
export const STYLE_SHORT: Record<StyleKey, string> = {
  ...STYLE_LABELS,
  props: '道具',
  bannedBackdrop: '禁止出现',
  bannedScene: '禁止出现',
};

export const isBackdropKey = (k: StyleKey): k is BackdropKey => (BACKDROP_KEYS as readonly string[]).includes(k);

// 生成新背景时必填；用模板时不检查背景风格（内置模板参数为空）
export const BACKDROP_REQUIRED = ['tone', 'background', 'light'] as const satisfies readonly BackdropKey[];
// 合成必填（取代 v0.5 的 STYLE_REQUIRED）
export const SCENE_REQUIRED = ['placement', 'composition'] as const satisfies readonly SceneKey[];

// 道具留空时显示的说法
export const NO_PROPS = '不放道具';

// 小间标「你说的」时附的原话片段，去掉空格和标点后至少几个字才核对（BC-013），太短的片段到处都能对上
export const SAID_QUOTE_MIN = 2;

export const TONE_OPTIONS = [
  { name: '雨后苔绿', desc: '低饱和绿，偏冷', colors: ['#dfe4d5', '#b9c4a6', '#7e8f6c'] },
  { name: '奶油米白', desc: '暖白，柔和', colors: ['#f3ede2', '#e6dac6', '#c9b79a'] },
  { name: '石灰浅灰', desc: '中性灰，干净', colors: ['#ecebe8', '#d5d3ce', '#a8a49d'] },
  { name: '干燥玫瑰', desc: '灰调粉，温柔', colors: ['#efe3e1', '#ddc5c1', '#b8928c'] },
  { name: '深墨对比', desc: '深色底，高对比', colors: ['#3a3a38', '#2a2a28', '#8d8a82'] },
] as const;

// 摆放里含展示用具（支架、挂钩、首饰托盘）：套用的背景里没有时，合成时按摆放加上（2026-11-22 发起人确认）
export const STYLE_OPTIONS: Partial<Record<StyleKey, readonly string[]>> = {
  tone: TONE_OPTIONS.map((t) => t.name),
  background: ['手工纸', '亚麻布', '原木', '石材', '纯色背景'],
  light: ['柔和自然光', '窗边侧光', '暖调午后光', '清冷晨光', '明暗对比光'],
  placement: ['平铺', '悬挂', '支架', '首饰托盘'],
  composition: ['主体居中，留白多', '主体偏一侧，留出呼吸感', '主体放大，突出细节'],
};

export const toneColors = (tone: string): readonly string[] | null =>
  TONE_OPTIONS.find((t) => tone.includes(t.name))?.colors ?? null;
