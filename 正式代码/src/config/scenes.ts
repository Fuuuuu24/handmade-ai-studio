import type { SceneParams } from '@/domain/types';

// 内置摄影布景模版（沿用 v3 原型）：首页卡片和方案共用。示意图待提供，现在只用色块。
export interface BuiltinScene {
  id: string;
  name: string;
  desc: string;
  colors: readonly string[];
  params: SceneParams;
}

export const BUILTIN_SCENES: readonly BuiltinScene[] = [
  {
    id: 'tpl-moss',
    name: '雨后清晨',
    desc: '苔绿手工纸，清冷晨光',
    colors: ['#dfe4d5', '#b9c4a6', '#7e8f6c'],
    params: { tone: '雨后苔绿', background: '手工纸', light: '清冷晨光', placement: '平铺', props: '一小片苔藓', banned: '', composition: '主体偏一侧，留出呼吸感' },
  },
  {
    id: 'tpl-cream',
    name: '午后书桌',
    desc: '米白亚麻，暖调午后光',
    colors: ['#f3ede2', '#e6dac6', '#c9b79a'],
    params: { tone: '奶油米白', background: '亚麻布', light: '暖调午后光', placement: '平铺', props: '一本旧书的一角', banned: '', composition: '主体居中，留白多' },
  },
  {
    id: 'tpl-stone',
    name: '干净陈列',
    desc: '浅灰石材，柔和自然光',
    colors: ['#ecebe8', '#d5d3ce', '#a8a49d'],
    params: { tone: '石灰浅灰', background: '石材', light: '柔和自然光', placement: '支架', props: '', banned: '', composition: '主体放大，突出细节' },
  },
  {
    id: 'tpl-rose',
    name: '温柔礼物',
    desc: '灰粉手工纸，柔光',
    colors: ['#efe3e1', '#ddc5c1', '#b8928c'],
    params: { tone: '干燥玫瑰', background: '手工纸', light: '柔和自然光', placement: '悬挂', props: '一段丝带', banned: '', composition: '主体居中，留白多' },
  },
];

export const builtinScene = (id: string) => BUILTIN_SCENES.find((s) => s.id === id) ?? null;
