import type { Ratio } from './ratios';

// 背景图（PRD FR-06、AC-08.0，技术写法 13.4）：先生成不含商品的背景图，再拿它和三视图合成。
// 比例由系统固定（2026-11-22 代理自定，可再调），一次生成两张、用户选一张
export const BACKDROP = {
  ratio: '3:4' as Ratio,
  count: 2,
};

// 内置模板背景图：图片由发起人准备（放 public/backdrops/），参数先留空（2026-11-22 发起人定）。
// 编号带版本（builtin:名字@版本，文件名 名字-v版本.jpg）：换图就加一个新版本，旧版本标 retired、图片保留，
// 用过旧版本的作品和历史结果仍对应原来的图（AC-06.5）。
// 图片到位前 image 为空：用色块示意，界面标「示意，待替换」，合成时用这组颜色渲染成的图作参考
export interface BuiltinBackdrop {
  id: string;
  name: string;
  image: string | null; // public 下的路径，比如 /backdrops/moss-v1.jpg
  colors: readonly [string, string, string];
  retired?: boolean; // 被新版本取代：模板库里不再列出，用过的作品照常能用
}

export const BUILTIN_BACKDROPS: readonly BuiltinBackdrop[] = [
  { id: 'builtin:moss@1', name: '雨后清晨', image: null, colors: ['#dfe4d5', '#b9c4a6', '#7e8f6c'] },
  { id: 'builtin:cream@1', name: '午后书桌', image: null, colors: ['#f3ede2', '#e6dac6', '#c9b79a'] },
  { id: 'builtin:stone@1', name: '干净陈列', image: null, colors: ['#ecebe8', '#d5d3ce', '#a8a49d'] },
  { id: 'builtin:rose@1', name: '温柔礼物', image: null, colors: ['#efe3e1', '#ddc5c1', '#b8928c'] },
];

export const BUILTIN_PREFIX = 'builtin:';

export const isBuiltinBackdrop = (id: string | null | undefined): boolean => !!id?.startsWith(BUILTIN_PREFIX);

export const builtinBackdrop = (id: string) => BUILTIN_BACKDROPS.find((b) => b.id === id) ?? null;

// 模板库里列出的内置模板（不含被新版本取代的）
export const listedBuiltins = () => BUILTIN_BACKDROPS.filter((b) => !b.retired);

// 背景这一步的两种做法（技术写法 13.4）
export const BACKDROP_MODE_NAMES = { library: '用模板库里的', generate: '自己生成' } as const;
