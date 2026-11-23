import { stateSummary } from '@/agent/state';
import { chatModel, DEFAULT_CHAT_MODEL, imageModel } from '@/config/models';
import { ASSET_KINDS } from '@/config/upload';
import { VIEW_ANGLES, VIEW_NAMES } from '@/config/views';
import { getBlob, listSavedBackdrops } from '@/data/repo';
import { activeUploads, angleUpload, currentView } from '@/domain/assets';
import { libraryList } from '@/domain/backdrops';
import type { BackdropRef } from '@/domain/types';
import { backdropImage } from './backdrops';
import { blobToDataUrl, prepareDerived } from './images';
import { loadContext, type WorkContext } from './work-store';

const MAX_PHOTOS = 6;

export interface ChatPhoto {
  id: string; // 图的编号（三视图、照片是素材编号，背景图、结果是各自的编号）：同一张图只附一次
  label: string; // 在作品状态里写明每张是什么
  blob: () => Promise<Blob | undefined>;
}

// 背景图给小间看的小图：数据库里的有缩略图；内置模板的图片先缩小
async function backdropThumb(ref: BackdropRef): Promise<Blob> {
  const blob = await backdropImage(ref, 'thumb');
  return ref.builtin && ref.image ? (await prepareDerived(blob)).thumb : blob;
}

// 小间能看到的图（技术写法 13.9）：三视图（还没生成的角度用原图）、选定的背景图，剩下的位置给细节照和未分类的照片
// （AC-02.3a：细节照只给小间看，不进合成）。first 是要排在最前面的图，比如生成通知里这次的结果；
// 已经排在最前面的那几张不再加第二遍，免得挤掉背景图和细节照（评审第 3 条）
export function chatPhotos(ctx: WorkContext, first: readonly ChatPhoto[] = []): ChatPhoto[] {
  const list: ChatPhoto[] = [];
  const add = (p: ChatPhoto) => void (list.some((x) => x.id === p.id) || list.push(p));
  first.forEach(add);
  const { work } = ctx;
  for (const angle of VIEW_ANGLES) {
    const v = currentView(ctx.assets, work.id, angle);
    const p = angleUpload(ctx.assets, work.id, angle);
    if (v) add({ id: v.id, label: `${VIEW_NAMES[angle]}三视图${v.confirmed ? '' : '（用户还没确认）'}`, blob: () => getBlob(v.thumbId) });
    else if (p) add({ id: p.id, label: `${VIEW_NAMES[angle]}原图（还没有三视图）`, blob: () => getBlob(p.thumbId) });
  }
  const bd = ctx.backdrop;
  if (bd) add({ id: bd.id, label: `选定的背景图「${bd.name}」${bd.placeholder ? '（内置模板的示意色块，图还没提供）' : ''}`, blob: () => backdropThumb(bd) });
  for (const a of activeUploads(ctx.assets, work.id).filter((x) => x.kind === 'detail' || x.kind === 'unsorted')) {
    add({ id: a.id, label: `${ASSET_KINDS[a.kind]}照片`, blob: () => getBlob(a.thumbId) });
  }
  return list.slice(0, MAX_PHOTOS);
}

// 模板库里可选的背景图，顺序和画布、首页一样（libraryList）
export const libraryRefs = async (): Promise<BackdropRef[]> => libraryList(await listSavedBackdrops());

// 每次发给小间的附加内容：作品状态和图片在发送时从本地数据库现读，保证是最新的
export async function chatRequestBody(workId: string, first: readonly ChatPhoto[] = []) {
  const ctx = await loadContext(workId);
  const cm = chatModel(ctx.work.chatModel) ?? chatModel(DEFAULT_CHAT_MODEL)!;
  const photos: string[] = [];
  const labels: string[] = [];
  const missing: string[] = [];
  for (const p of cm.vision ? chatPhotos(ctx, first) : []) {
    const blob = await p.blob().catch(() => undefined);
    if (!blob) {
      missing.push(p.label);
      continue;
    }
    photos.push(await blobToDataUrl(blob));
    labels.push(p.label);
  }
  const state = stateSummary({
    ...ctx,
    library: await libraryRefs(),
    chatModel: cm,
    imageModelLabel: imageModel(ctx.work.imageModel)?.label ?? ctx.work.imageModel,
    photoLabels: labels,
    missingPhotos: missing,
  });
  return { chatModel: cm.id, state, photos };
}

// 对话接口失败时，服务端返回的 JSON 里有中文原因；流里的错误已经是中文
export function chatErrorMessage(e: Error): string {
  try {
    const body = JSON.parse(e.message);
    if (body?.error?.message) return body.error.message;
  } catch {
    // 不是 JSON，原样显示
  }
  return e.message || '未知错误';
}
