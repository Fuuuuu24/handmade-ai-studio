import { getBackdrop, getBlob, logEvent, patchBackdrop } from '@/data/repo';
import { backdropNameProblem, userPickProblem } from '@/domain/backdrops';
import type { BackdropRef, Id } from '@/domain/types';
import { chooseCandidate, chooseLibraryBackdrop } from '@/domain/work';
import { loadContext, mutateWork, resolveBackdrop } from './work-store';

export { resolveBackdrop };

/* 背景图（技术写法 13.4、13.6）：内置模板只写在配置里，其余存在 backdrops 表；这里统一成 BackdropRef。
   沉淀、改名、删除只由界面按钮在用户点了之后调用（PRD 4.2 第 2 条），小间没有对应工具。 */

// 内置模板的图还没提供时，用它的示意色块渲染一张 3:4 的图（和界面上的色块一样的渐变），合成时作参考图
async function placeholderImage(colors: readonly string[], width = 768, height = 1024): Promise<Blob> {
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
  return placeholderImage(ref.colors ?? ['#eeeeee', '#dddddd', '#cccccc'], which === 'thumb' ? 384 : 768, which === 'thumb' ? 512 : 1024);
}

export type PickOutcome = { ok: true } | { ok: false; reason: string };

// 用户在画布上选背景图：模板库里的，或这一轮的背景候选（候选只能用户点，技术写法 13.7）
export async function pickBackdrop(workId: Id, id: Id): Promise<PickOutcome> {
  const ctx = await loadContext(workId);
  if (ctx.busy.scene) return { ok: false, reason: '正在合成这一轮候选，等结束后再换背景' };
  const ref = await resolveBackdrop(id);
  const problem = userPickProblem(ref, ctx.work);
  if (problem) return { ok: false, reason: problem };
  const candidate = !ref!.builtin && !ref!.saved && ref!.workId === workId;
  await mutateWork(workId, (c) => (candidate ? chooseCandidate(c.work, id) : chooseLibraryBackdrop(c.work, id)));
  void logEvent(candidate ? 'pick_backdrop' : 'use_template', workId, { builtin: ref!.builtin });
  return { ok: true };
}

// 沉淀进模板库：起个名字；沉淀后别的作品可以套用（AC-06.4）
export async function saveToLibrary(id: Id, name: string): Promise<PickOutcome> {
  const problem = backdropNameProblem(name);
  if (problem) return { ok: false, reason: problem };
  const b = await getBackdrop(id);
  if (!b) return { ok: false, reason: '找不到这张背景图' };
  await patchBackdrop(id, (x) => {
    x.name = name.trim();
    x.savedAt = x.savedAt ?? Date.now();
    x.deletedAt = null;
  });
  void logEvent('save_backdrop', b.workId);
  return { ok: true };
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
