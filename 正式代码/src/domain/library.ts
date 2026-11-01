import { STYLE_KEYS, STYLE_LABELS, STYLE_REQUIRED, type StyleKey } from '@/config/style';
import { styleValuesOf } from './snapshot';
import type { Scene, SceneParams, ShopStyle, Work } from './types';
import { newId } from './util';

/* 摄影布景与我的风格（PRD FR-06）。都只在用户明确同意时写入（PRD 4.2 第 2 条、AC-06.4）；
   这里只有纯函数，写入由界面按钮调用，小间只能「提议」。 */

const SCENE_KEYS = STYLE_KEYS.filter((k): k is keyof SceneParams => k !== 'expression');

// 布景是方案参数，不是某张结果图（AC-06.2）；不带商品结构、故事、尺寸（AC-06.3），所以不含「表达」
export const sceneParamsOf = (work: Work): SceneParams => {
  const v = styleValuesOf(work);
  return Object.fromEntries(SCENE_KEYS.map((k) => [k, v[k]])) as SceneParams;
};

// 存布景前要选齐的几项（和批准时一样）
export function sceneSaveProblem(params: SceneParams, name: string): string | null {
  if (!name.trim()) return '布景要起个名字';
  const lack = STYLE_REQUIRED.filter((k) => !params[k].trim());
  return lack.length ? `风格还缺：${lack.map((k) => STYLE_LABELS[k]).join('、')}，选齐再存` : null;
}

export function newScene(name: string, params: SceneParams, at = Date.now()): Scene {
  return { id: newId('scene'), name: name.trim(), params, version: 1, history: [], createdAt: at, updatedAt: at };
}

// 更新已存布景：旧版本进历史，历史方案仍指向当时的参数（AC-06.5）
export function updateScene(scene: Scene, params: SceneParams, name = scene.name, at = Date.now()): Scene {
  return {
    ...scene,
    name: name.trim() || scene.name,
    params,
    version: scene.version + 1,
    history: [...scene.history, { version: scene.version, name: scene.name, params: scene.params, at: scene.updatedAt }],
    updatedAt: at,
  };
}

export const sameParams = (a: SceneParams, b: SceneParams) => SCENE_KEYS.every((k) => a[k].trim() === b[k].trim());

export const sceneChanges = (a: SceneParams, b: SceneParams) => SCENE_KEYS.filter((k) => a[k].trim() !== b[k].trim()).map((k) => STYLE_LABELS[k]);

/* ---------- 我的风格 ---------- */

export type ShopItems = Partial<Record<StyleKey, string>>;

// 和现有长期风格比，真正会变的项
export function shopDiff(shop: ShopStyle, items: ShopItems): ShopItems {
  const out: ShopItems = {};
  for (const k of STYLE_KEYS) {
    const v = items[k];
    if (v === undefined) continue;
    if ((shop.prefs[k] ?? '').trim() !== v.trim()) out[k] = v.trim();
  }
  return out;
}

// 用户同意后才调用：写入变化的项，并留一条修改记录（AC-06.4）；值为空表示从长期风格里去掉这一项
export function updateShopStyle(shop: ShopStyle, items: ShopItems, reason: string, at = Date.now()): ShopStyle {
  const diff = shopDiff(shop, items);
  const keys = Object.keys(diff) as StyleKey[];
  if (!keys.length) return shop;
  const prefs = { ...shop.prefs };
  const before: ShopItems = {};
  for (const k of keys) {
    before[k] = shop.prefs[k] ?? '';
    if (diff[k]) prefs[k] = diff[k];
    else delete prefs[k];
  }
  return { ...shop, prefs, history: [...shop.history, { at, before, after: diff, reason: reason.trim() }] };
}

// 作品当前的风格里，可以写进长期风格的项（有值的）
export const shopItemsOf = (work: Work, keys: readonly StyleKey[] = STYLE_KEYS): ShopItems => {
  const v = styleValuesOf(work);
  return Object.fromEntries(keys.filter((k) => v[k]).map((k) => [k, v[k]]));
};

