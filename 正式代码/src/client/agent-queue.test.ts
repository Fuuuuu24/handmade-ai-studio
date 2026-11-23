import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { NOTICE } from '@/config/notices';
import { newWork, queueHandoff } from '@/domain/work';
import { result, stateOf, task } from '@/test/fixtures';
import { hasHeld, queueDue, sendQueued, type QueuedMessage } from './agent-queue';

const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
const msg = (text: string): QueuedMessage => ({ text, system: 'notice', photos: [] });
type Taken = { message: QueuedMessage | null; retryInMs: number | null };

describe('有没有要代发的：先看现成的数据，没有就不去读库（评审第 12 条）', () => {
  it('交接、生成通知、验收通知各自算；验收还要等时给出等多久', () => {
    expect(queueDue(stateOf(w), 0)).toEqual({ ready: false, waitMs: null });
    expect(queueDue(stateOf(queueHandoff(w, 'product')), 0)).toEqual({ ready: true, waitMs: null });
    const finished = { ...task(w.id, 1, 0, 'failed'), notifiedAt: null };
    const other = { ...task(w.id, 1, 1, 'succeeded'), notifiedAt: null };
    expect(queueDue(stateOf(w, [], { tasks: [finished, other] }), 0)).toEqual({ ready: true, waitMs: null });
    // 那一轮还有一张在生成：先不发
    expect(queueDue(stateOf(w, [], { tasks: [finished, task(w.id, 1, 1, 'running')] }), 0).ready).toBe(false);
    const judged = { ...result(w.id, 1, 0, { real: 'ok', style: 'bad' }), verdictAt: 1000 };
    expect(queueDue(stateOf(w, [], { results: [judged] }), 1000 + NOTICE.settleMs - 2000)).toEqual({ ready: false, waitMs: 2000 });
    expect(queueDue(stateOf(w, [], { results: [judged] }), 1000 + NOTICE.settleMs)).toEqual({ ready: true, waitMs: null });
  });
});

describe('代发排队的消息（评审第 4 条）', () => {
  it('同一件作品同一时间只跑一个；跑的时候又来取过，跑完提醒再看一次', async () => {
    let finish!: (v: Taken) => void;
    const take = vi.fn(() => new Promise<Taken>((r) => (finish = r)));
    const send = vi.fn();
    const first = sendQueued('w_one', () => true, send, take);
    expect(await sendQueued('w_one', () => true, send, take)).toEqual({ sent: false, retryInMs: null, recheck: false });
    expect(take).toHaveBeenCalledTimes(1);
    finish({ message: msg('交接'), retryInMs: null });
    expect(await first).toEqual({ sent: true, retryInMs: null, recheck: true });
    expect(send).toHaveBeenCalledWith(msg('交接'));
    // 另一件作品不受影响
    await sendQueued('w_two', () => true, send, async () => ({ message: null, retryInMs: 500 }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('不空闲时不认领（认领了发不出去，刷新就丢了）', async () => {
    const take = vi.fn(async (): Promise<Taken> => ({ message: msg('三视图好了'), retryInMs: null }));
    expect(await sendQueued('w_busy', () => false, vi.fn(), take)).toEqual({ sent: false, retryInMs: null, recheck: false });
    expect(take).not.toHaveBeenCalled();
  });

  it('取的过程中对话变忙了：先留着，不再认领新的；下次空闲时先发它', async () => {
    let idle = true;
    const take = vi.fn(async (): Promise<Taken> => {
      idle = false; // 认领的那一会儿用户开始打字了
      return { message: msg('三视图好了'), retryInMs: null };
    });
    const send = vi.fn();
    expect(await sendQueued('w_held', () => idle, send, take)).toEqual({ sent: false, retryInMs: null, recheck: false });
    expect(hasHeld('w_held')).toBe(true);
    expect(send).not.toHaveBeenCalled();
    // 还不空闲：不发，也不再认领
    await sendQueued('w_held', () => idle, send, take);
    expect(take).toHaveBeenCalledTimes(1);
    idle = true;
    expect(await sendQueued('w_held', () => idle, send, take)).toEqual({ sent: true, retryInMs: null, recheck: false });
    expect(send).toHaveBeenCalledWith(msg('三视图好了'));
    expect(take).toHaveBeenCalledTimes(1);
    expect(hasHeld('w_held')).toBe(false);
  });

  it('认领出错时如实抛出，下次还能再取', async () => {
    const send = vi.fn();
    await expect(sendQueued('w_err', () => true, send, async () => Promise.reject(new Error('数据库打不开')))).rejects.toThrow('数据库打不开');
    expect(await sendQueued('w_err', () => true, send, async () => ({ message: msg('好了'), retryInMs: null }))).toMatchObject({ sent: true });
  });
});
