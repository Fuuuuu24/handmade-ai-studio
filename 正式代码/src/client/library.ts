import type { StyleKey } from '@/config/style';
import { getScene, getShopStyle, logEvent, saveScene, saveShopStyle } from '@/data/repo';
import { newScene, sceneParamsOf, sceneSaveProblem, shopItemsOf, updateScene, updateShopStyle } from '@/domain/library';
import type { Id, Scene } from '@/domain/types';
import { loadContext } from './work-store';

/* 存布景、更新我的风格：只由界面按钮在用户明确同意后调用（PRD 4.2 第 2 条）。小间的工具只放提议卡片。 */

export type SaveOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };

// 把作品现在的方案存成布景：新建，或更新一套已存的布景（生成新版本，AC-06.5）
export async function saveSceneFromWork(workId: Id, name: string, updateId?: Id): Promise<SaveOutcome<Scene>> {
  const ctx = await loadContext(workId);
  const params = sceneParamsOf(ctx.work);
  const problem = sceneSaveProblem(params, name);
  if (problem) return { ok: false, reason: problem };
  let scene: Scene;
  if (updateId) {
    const old = await getScene(updateId);
    if (!old) return { ok: false, reason: '要更新的布景不存在或已删除' };
    scene = updateScene(old, params, name);
  } else {
    scene = newScene(name, params);
  }
  await saveScene(scene);
  void logEvent('save_scene', workId, { version: scene.version });
  return { ok: true, value: scene };
}

// 把作品里选定的几项写进我的风格（用户同意后），留修改记录
export async function saveShopFromWork(workId: Id, keys: readonly StyleKey[], reason: string): Promise<SaveOutcome<number>> {
  const ctx = await loadContext(workId);
  const items = shopItemsOf(ctx.work, keys);
  if (!Object.keys(items).length) return { ok: false, reason: '选中的几项都还没定，没有可以存的' };
  const shop = await getShopStyle();
  const next = updateShopStyle(shop, items, reason.trim() || `来自作品「${ctx.work.name}」`);
  if (next === shop) return { ok: false, reason: '和现在的长期风格一样，不用更新' };
  await saveShopStyle(next);
  void logEvent('update_shop_style', workId, { fields: Object.keys(items).length });
  return { ok: true, value: Object.keys(items).length };
}
