import { WHITE } from '@/config/white';
import { isActive } from './generation';
import type { Asset, Id, Task, Work } from './types';

/* 白底图（A 路线，PRD 4.3、AC-02.2）：从原图派生，原图不动；商家对照原图选用一张后再确认资产。 */

export const whiteTasks = (tasks: readonly Task[], sourceAssetId: Id) =>
  tasks.filter((t) => t.kind === 'white' && t.sourceAssetId === sourceAssetId).sort((a, b) => a.createdAt - b.createdAt);

export const makingWhite = (tasks: readonly Task[], workId: Id) =>
  tasks.some((t) => t.workId === workId && t.kind === 'white' && isActive(t));

// 某张原图派生出的白底图（不含已停用的）
export const whitesOf = (assets: readonly Asset[], parentId: Id) =>
  assets.filter((a) => a.origin === 'white' && a.parentId === parentId && !a.removed).sort((a, b) => a.createdAt - b.createdAt);

export type WhiteCheck = { ok: true } | { ok: false; reason: string };

// 能不能给这张原图做白底：界面按钮和小间的 make_white_asset 用同一份
export function whiteCheck(work: Work, assets: readonly Asset[], tasks: readonly Task[], assetId: Id, isGenerating: boolean): WhiteCheck {
  if (work.route !== 'A') return { ok: false, reason: '现在用的是原图路线，不需要白底图' };
  const a = assets.find((x) => x.id === assetId && x.workId === work.id);
  if (!a || a.origin !== 'upload' || a.removed) return { ok: false, reason: '找不到这张作品照片（只能用在用的原图做白底）' };
  if (a.kind === 'detail') return { ok: false, reason: '细节照直接作参考图，不用做白底；白底图用整体照或背面照做' };
  if (isGenerating) return { ok: false, reason: '正在生成这一轮候选，等结束后再做白底' };
  const list = whiteTasks(tasks, assetId);
  if (list.some(isActive)) return { ok: false, reason: '这张照片的白底图正在做' };
  if (list.length >= WHITE.perAsset) return { ok: false, reason: `这张照片已经做过 ${WHITE.perAsset} 次白底，先从已有的里面选，或换一张照片` };
  return { ok: true };
}

// 选用的白底图停用后，选择也要清掉
export const whiteChoiceValid = (work: Work, assets: readonly Asset[]) =>
  !work.whiteChoice || assets.some((a) => a.id === work.whiteChoice && a.origin === 'white' && !a.removed);
