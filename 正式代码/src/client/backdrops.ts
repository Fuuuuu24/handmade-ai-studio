import { BACKDROP } from '@/config/backdrops';
import { ratioHeight } from '@/config/ratios';
import { getBackdrop, getBlob, logEvent, patchBackdrop } from '@/data/repo';
import { backdropNameProblem, ownBackdrop, pickLockProblem, userPickProblem } from '@/domain/backdrops';
import type { BackdropMode, BackdropRef, Id } from '@/domain/types';
import { chooseBackdrop, setBackdropMode } from '@/domain/work';
import { loadContext, mutateWork, resolveBackdrop } from './work-store';

export { resolveBackdrop };

/* 背景图（技术写法 13.4、13.6）：内置模板只写在配置里，其余存在 backdrops 表；这里统一成 BackdropRef。
   选定背景候选、沉淀进模板库：用户点，或问过用户、用户同意后小间代点；改名小间可以直接做；
   从模板库删除要用户在确认框里点「确认」，小间可以发起（PRD 4.2 第 2、5 条，技术写法 14.3）。 */

// 内置模板的图还没提供时，用它的示意色块渲染一张背景比例的图（和界面上的色块一样的渐变），合成时作参考图。
// 尺寸见 config/backdrops.ts
async function placeholderImage(colors: readonly string[], which: 'full' | 'thumb'): Promise<Blob> {
  const width = BACKDROP.placeholderWidth[which];
  const height = ratioHeight(BACKDROP.ratio, width);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.6, colors[1] ?? colors[0]);
  g.addColorStop(1, colors[2] ?? colors[1] ?? colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

// 背景图的图片：合成时作第 1 张参考图，也给小间看。读不出来时如实报错，不悄悄换成别的图
export async function backdropImage(ref: BackdropRef, which: 'full' | 'thumb' = 'full'): Promise<Blob> {
  if (!ref.builtin) {
    const blob = await getBlob((which === 'thumb' ? ref.thumbId : ref.blobId) ?? '');
    if (!blob) throw new Error(`背景图「${ref.name}」在本地找不到了（可能清理过浏览器数据）`);
    return blob;
  }
  if (ref.image) {
    const res = await fetch(ref.image).catch(() => null);
    if (!res?.ok) throw new Error(`内置模板「${ref.name}」的图片读不出来`);
    return res.blob();
  }
  return placeholderImage(ref.colors ?? ['#eeeeee', '#dddddd', '#cccccc'], which);
}

export type PickOutcome = { ok: true } | { ok: false; reason: string };

// 试用事件里记下是谁点的：小间问过、用户同意后代点的记 by: 'agent'（技术写法 14.4）
type By = 'agent' | undefined;
const byOf = (by: By): Record<string, string> => (by ? { by } : {});

// 在画布上选背景图：模板库里的，或这件作品的背景候选（候选由用户点，或问过用户后小间代点，技术写法 14.4）。
// 做法跟着背景图的来源走（chooseBackdrop）；两种生成进行中都不能换，和画布上锁住的按钮一致
export async function pickBackdrop(workId: Id, id: Id, by?: By): Promise<PickOutcome> {
  const ctx = await loadContext(workId);
  const locked = pickLockProblem(ctx.busy);
  if (locked) return { ok: false, reason: locked };
  const ref = await resolveBackdrop(id);
  const problem = userPickProblem(ref, ctx.work);
  if (problem) return { ok: false, reason: problem };
  await mutateWork(workId, (c) => chooseBackdrop(c.work, ref!));
  void logEvent(ownBackdrop(ctx.work, ref!) ? 'pick_backdrop' : 'use_template', workId, { builtin: ref!.builtin, ...byOf(by) });
  return { ok: true };
}

// 沉淀进模板库：起个名字；沉淀后别的作品可以套用（AC-06.4）
export async function saveToLibrary(id: Id, name: string, by?: By): Promise<PickOutcome> {
  const problem = backdropNameProblem(name);
  if (problem) return { ok: false, reason: problem };
  const b = await getBackdrop(id);
  if (!b) return { ok: false, reason: '找不到这张背景图' };
  await patchBackdrop(id, (x) => {
    x.name = name.trim();
    x.savedAt = x.savedAt ?? Date.now();
    x.deletedAt = null;
  });
  void logEvent('save_backdrop', b.workId, byOf(by));
  return { ok: true };
}

// 换背景的做法（画布上的二选一、小间的 set_backdrop_mode、问过用户后代点的「改成自己生成」都走这里）：
// 换做法时清掉已选的背景图；流程二改成自己生成时切到流程一（setBackdropMode）
export async function chooseBackdropMode(workId: Id, mode: BackdropMode, by?: By): Promise<{ changed: boolean; flowChanged: boolean }> {
  let changed = false;
  let flowChanged = false;
  await mutateWork(workId, (c) => {
    const next = setBackdropMode(c.work, mode);
    changed = next !== c.work;
    flowChanged = changed && c.work.flow !== next.flow;
    return next;
  });
  if (changed) void logEvent('backdrop_mode', workId, { mode, flowChanged, ...byOf(by) });
  return { changed, flowChanged };
}

export async function renameBackdrop(id: Id, name: string): Promise<PickOutcome> {
  const problem = backdropNameProblem(name);
  if (problem) return { ok: false, reason: problem };
  await patchBackdrop(id, (x) => {
    x.name = name.trim();
  });
  return { ok: true };
}

// 从模板库删除：只做标记，已经选了它的作品照常可以合成，历史结果仍能看到（AC-06.4）
export async function deleteFromLibrary(id: Id): Promise<void> {
  await patchBackdrop(id, (x) => {
    x.deletedAt = Date.now();
  });
  void logEvent('delete_backdrop');
}
