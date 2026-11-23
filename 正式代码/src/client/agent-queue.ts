import { NOTICE } from '@/config/notices';
import { getBlob, claimHandoffs, claimTaskNotices, claimVerdicts } from '@/data/repo';
import { factsOf, handoffText, type HandoffStep } from '@/domain/handoff';
import { noticeText, pendingNotices, pendingVerdicts, verdictKey, verdictText } from '@/domain/notices';
import { VIEW_NAMES } from '@/config/views';
import type { WorkState } from '@/domain/types';
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
      if (view) photos.push({ id: view.id, label: `刚生成的${VIEW_NAMES[t.view!]}三视图`, blob: () => getBlob(view.thumbId) });
      const bd = t.backdropId ? fresh.backdrops.find((x) => x.id === t.backdropId) : undefined;
      if (bd) photos.push({ id: bd.id, label: `刚生成的第 ${bd.round} 轮背景 ${bd.slot + 1}`, blob: () => getBlob(bd.thumbId) });
      const res = fresh.results.find((r) => r.taskId === t.id);
      if (res) photos.push({ id: res.id, label: `刚生成的第 ${res.round} 轮候选 ${res.slot + 1}`, blob: () => getBlob(res.thumbId ?? res.blobId) });
    }
  }

  // 3. 验收通知：两项都点了、用户停手了一会儿
  const { ready, waitMs } = pendingVerdicts(fresh, now, NOTICE.settleMs);
  const got = new Set(await claimVerdicts(ready.map((r) => ({ id: r.id, key: verdictKey(r) }))));
  for (const r of ready.filter((x) => got.has(x.id))) {
    parts.push(verdictText(r));
    photos.push({ id: r.id, label: `验收的第 ${r.round} 轮候选 ${r.slot + 1}`, blob: () => getBlob(r.thumbId ?? r.blobId) });
  }

  const message = parts.length ? { text: parts.join('\n\n'), system: steps.length ? ('handoff' as const) : ('notice' as const), photos } : null;
  return { message, retryInMs: waitMs };
}

// 现成的作品数据里有没有要代发的（评审第 12 条）：排队的交接、可以发的生成通知、停手够久的验收通知。
// 对话面板每次数据变化都会问一次，没有就不去读库认领；waitMs 是验收通知还要等多久
export function queueDue(s: WorkState, now: number): { ready: boolean; waitMs: number | null } {
  if (s.work.pendingHandoffs?.length || pendingNotices(s).length) return { ready: true, waitMs: null };
  const { ready, waitMs } = pendingVerdicts(s, now, NOTICE.settleMs);
  return { ready: ready.length > 0, waitMs };
}

type Taken = Awaited<ReturnType<typeof takeQueue>>;

interface Runner {
  running: boolean; // 正在跑 takeQueue
  again: boolean; // 跑的时候又有人来取过：跑完要再看一次
  held: QueuedMessage | null; // 取到时对话已经不空闲：留着，下次空闲时先发
}
const runners = new Map<string, Runner>();
const runnerOf = (workId: string): Runner => {
  const r = runners.get(workId) ?? { running: false, again: false, held: null };
  runners.set(workId, r);
  return r;
};

export const hasHeld = (workId: string) => !!runners.get(workId)?.held;

/* 对话空闲时代发排队的消息（评审第 4 条）。AI SDK 的 sendMessage 不防并发，两条请求同时跑回复会交错，所以：
   - 同一件作品同一时间只跑一个 takeQueue：认领要写库，写库又会让面板再来取一次；
   - 取到后马上（同一步里）看对话还空不空闲，空闲才发；不空闲（用户开始打字、刚发了消息、面板卸载了）先留着，
     下次空闲时先发它，留着的时候不再认领新的；
   - recheck：跑的过程中又有人来取过，跑完要再看一次，免得这期间新排进来的没人取。 */
export async function sendQueued(
  workId: string,
  isIdle: () => boolean,
  send: (m: QueuedMessage) => void,
  take: (workId: string) => Promise<Taken> = takeQueue,
): Promise<{ sent: boolean; retryInMs: number | null; recheck: boolean }> {
  const r = runnerOf(workId);
  const idleNow = { sent: false, retryInMs: null, recheck: false };
  if (r.running) {
    r.again = true;
    return idleNow;
  }
  if (r.held) {
    if (!isIdle()) return idleNow;
    const m = r.held;
    r.held = null;
    send(m);
    return { ...idleNow, sent: true };
  }
  // 不空闲就先不认领：认领会改数据库，取到又发不出去的话只能留在内存里，刷新就丢了（代码评审 2026-11-23）
  if (!isIdle()) return idleNow;
  r.running = true;
  r.again = false;
  let got: Taken;
  try {
    got = await take(workId);
  } finally {
    r.running = false;
  }
  const recheck = r.again;
  r.again = false;
  if (!got.message) return { sent: false, retryInMs: got.retryInMs, recheck };
  if (!isIdle()) {
    r.held = got.message;
    return { sent: false, retryInMs: got.retryInMs, recheck };
  }
  send(got.message);
  return { sent: true, retryInMs: got.retryInMs, recheck };
}

// 生成通知附的结果图排在附图最前面（技术写法 13.9）：发出通知前放进来，下一次对话请求取走
const firstPhotos = new Map<string, ChatPhoto[]>();
export const setFirstPhotos = (workId: string, photos: ChatPhoto[]) => void firstPhotos.set(workId, photos);
export function takeFirstPhotos(workId: string): ChatPhoto[] {
  const photos = firstPhotos.get(workId) ?? [];
  firstPhotos.delete(workId);
  return photos;
}
