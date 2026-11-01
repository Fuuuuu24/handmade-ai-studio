import { stateSummary } from '@/agent/state';
import { chatModel, DEFAULT_CHAT_MODEL, imageModel } from '@/config/models';
import { BUILTIN_SCENES } from '@/config/scenes';
import { getBlob, listScenes } from '@/data/repo';
import { activeUploads } from '@/domain/snapshot';
import type { SceneParams } from '@/domain/types';
import { blobToDataUrl } from './images';
import { loadContext, type WorkContext } from './work-store';

const MAX_PHOTOS = 6;

export const sceneDesc = (p: SceneParams) => [p.tone, p.background, p.light].filter(Boolean).join('，');

// 小间能看到的照片：当前在用的原图缩略图，A 路线再加选定的白底图
async function photoDataUrls(ctx: WorkContext): Promise<string[]> {
  const list = activeUploads(ctx.assets, ctx.work.id);
  const white = ctx.work.route === 'A' ? ctx.assets.find((a) => a.id === ctx.work.whiteChoice && !a.removed) : undefined;
  const out: string[] = [];
  for (const a of [...list, ...(white ? [white] : [])].slice(0, MAX_PHOTOS)) {
    const blob = await getBlob(a.thumbId);
    if (blob) out.push(await blobToDataUrl(blob));
  }
  return out;
}

// 每次发给小间的附加内容：作品状态和照片在发送时从本地数据库现读，保证是最新的
export async function chatRequestBody(workId: string) {
  const ctx = await loadContext(workId);
  const saved = await listScenes();
  const scenes = [
    ...BUILTIN_SCENES.map((s) => ({ id: s.id, name: s.name, desc: s.desc })),
    ...saved.map((s) => ({ id: s.id, name: s.name, desc: sceneDesc(s.params) })),
  ];
  const cm = chatModel(ctx.work.chatModel) ?? chatModel(DEFAULT_CHAT_MODEL)!;
  const state = stateSummary({
    work: ctx.work,
    assets: ctx.assets,
    approval: ctx.approval,
    tasks: ctx.tasks,
    results: ctx.results,
    scenes,
    basis: ctx.basis,
    current: ctx.snapshot,
    isGenerating: ctx.isGenerating,
    chatModel: cm,
    imageModelLabel: imageModel(ctx.work.imageModel)?.label ?? ctx.work.imageModel,
  });
  return { chatModel: cm.id, state, photos: cm.vision ? await photoDataUrls(ctx) : [] };
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
