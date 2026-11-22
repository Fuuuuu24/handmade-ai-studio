import { NOTICE } from '@/config/notices';
import { getBlob, claimHandoffs, claimTaskNotices, claimVerdicts } from '@/data/repo';
import { factsOf, handoffText, type HandoffStep } from '@/domain/handoff';
import { noticeText, pendingNotices, pendingVerdicts, verdictKey, verdictText } from '@/domain/notices';
import { VIEW_NAMES } from '@/config/views';
import type { ChatPhoto } from './chat-body';
import { loadContext, serial } from './work-store';

/* 小间跟上画布（PRD AC-11.3a—c，技术写法 13.12）：浏览器代用户发给小间的消息。对话面板空闲时取一次：
   排队的「下一步」交接在前，再是生成通知、验收通知，合成一条；内容在这一刻按作品数据生成，不经模型。
   认领都在事务里先写先得，两个标签页同时开着也只发一次。 */

export interface QueuedMessage {
  text: string;
  system: 'handoff' | 'notice';
  photos: ChatPhoto[]; // 这次的结果图，排在附图最前面
}

export async function takeQueue(workId: string, now = Date.now()): Promise<{ message: QueuedMessage | null; retryInMs: number | null }> {
  const ctx = await loadContext(workId);
  const parts: string[] = [];
  const photos: ChatPhoto[] = [];

  // 1. 交接：内容按现在的数据生成；同时记下快照，之后的变化写进作品状态
  const steps = (ctx.work.pendingHandoffs ?? []).length
    ? await serial(workId, async () => claimHandoffs(workId, factsOf(await loadContext(workId)), now))
    : [];
  const fresh = steps.length ? await loadContext(workId) : ctx;
  for (const step of steps) if (step !== 'result') parts.push(handoffText(fresh, step as HandoffStep));

  // 2. 生成通知：三视图一批、背景或候选一轮都有结果
  const batches = pendingNotices(fresh);
  const claimed = new Set(await claimTaskNotices(batches.flatMap((b) => b.tasks.map((t) => t.id)), now));
  for (const b of batches) {
    const tasks = b.tasks.filter((t) => claimed.has(t.id));
    if (!tasks.length) continue;
    parts.push(noticeText(fresh, { ...b, tasks }));
    for (const t of tasks) {
      if (t.status !== 'succeeded') continue;
      const view = t.viewAssetId ? fresh.assets.find((a) => a.id === t.viewAssetId) : undefined;
      if (view) photos.push({ label: `刚生成的${VIEW_NAMES[t.view!]}三视图`, blob: () => getBlob(view.thumbId) });
      const bd = t.backdropId ? fresh.backdrops.find((x) => x.id === t.backdropId) : undefined;
      if (bd) photos.push({ label: `刚生成的第 ${bd.round} 轮背景 ${bd.slot + 1}`, blob: () => getBlob(bd.thumbId) });
      const res = fresh.results.find((r) => r.taskId === t.id);
      if (res) photos.push({ label: `刚生成的第 ${res.round} 轮候选 ${res.slot + 1}`, blob: () => getBlob(res.thumbId ?? res.blobId) });
    }
  }

  // 3. 验收通知：两项都点了、用户停手了一会儿
  const { ready, waitMs } = pendingVerdicts(fresh, now, NOTICE.settleMs);
  const got = new Set(await claimVerdicts(ready.map((r) => ({ id: r.id, key: verdictKey(r) }))));
  for (const r of ready.filter((x) => got.has(x.id))) {
    parts.push(verdictText(r));
    photos.push({ label: `验收的第 ${r.round} 轮候选 ${r.slot + 1}`, blob: () => getBlob(r.thumbId ?? r.blobId) });
  }

  const message = parts.length ? { text: parts.join('\n\n'), system: steps.length ? ('handoff' as const) : ('notice' as const), photos } : null;
  return { message, retryInMs: waitMs };
}

// 生成通知附的结果图排在附图最前面（技术写法 13.9）：发出通知前放进来，下一次对话请求取走
const firstPhotos = new Map<string, ChatPhoto[]>();
export const setFirstPhotos = (workId: string, photos: ChatPhoto[]) => void firstPhotos.set(workId, photos);
export function takeFirstPhotos(workId: string): ChatPhoto[] {
  const photos = firstPhotos.get(workId) ?? [];
  firstPhotos.delete(workId);
  return photos;
}
