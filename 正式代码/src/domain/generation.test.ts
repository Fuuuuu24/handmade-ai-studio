import { describe, expect, it } from 'vitest';
import { result, task, viewTask } from '@/test/fixtures';
import { anyBusy, busyOf, crossBusy, generating, lastSlotTask, passed, retryCheck, roundResults, slotsOf, slotState } from './generation';

describe('补齐失败的一张（AC-08.5），背景和合成各算各的', () => {
  it('没生成过、还在生成、已成功时都不能补齐', () => {
    expect(retryCheck([], 'w', 'scene', 1, 0)).toEqual({ ok: false, reason: '这一张还没有生成过' });
    expect(retryCheck([task('w', 1, 0, 'running')], 'w', 'scene', 1, 0)).toEqual({ ok: false, reason: '这一张还在生成中' });
    expect(retryCheck([task('w', 1, 0, 'succeeded')], 'w', 'scene', 1, 0)).toEqual({ ok: false, reason: '这一张已经成功了' });
  });

  it('失败后可以补齐，次数到上限后不再允许', () => {
    const t1 = task('w', 1, 0, 'failed', 1);
    expect(retryCheck([t1], 'w', 'scene', 1, 0, 2)).toEqual({ ok: true, attempt: 2 });
    const t2 = task('w', 1, 0, 'failed', 2);
    expect(retryCheck([t1, t2], 'w', 'scene', 1, 0, 2)).toEqual({ ok: true, attempt: 3 });
    const t3 = task('w', 1, 0, 'failed', 3);
    expect(retryCheck([t1, t2, t3], 'w', 'scene', 1, 0, 2)).toEqual({ ok: false, reason: '这一张已经补齐过 2 次，先改方案再重新生成' });
  });

  it('只看同一作品、同一种、同一轮、同一张', () => {
    const tasks = [task('w', 1, 0, 'failed'), task('w', 1, 1, 'running'), task('x', 1, 0, 'succeeded'), task('w', 1, 0, 'succeeded', 1, 'backdrop')];
    expect(slotState(tasks, 'w', 'scene', 1, 0)).toBe('failed');
    expect(slotState(tasks, 'w', 'scene', 1, 1)).toBe('active');
    expect(slotState(tasks, 'w', 'scene', 2, 0)).toBe('empty');
    expect(slotState(tasks, 'w', 'backdrop', 1, 0)).toBe('succeeded');
    // 去掉正在生成的合成，免得被「合成中不能补背景」挡住（见下一条）
    expect(retryCheck(tasks.filter((t) => t.status !== 'running'), 'w', 'backdrop', 1, 0)).toEqual({ ok: false, reason: '这一张已经成功了' });
  });

  it('别的种类在生成时不能补齐，条件和发起一轮一样；同一种的另一张还在生成照样可以补（评审第 7 条）', () => {
    const bd = task('w', 1, 0, 'failed', 1, 'backdrop');
    const sc = task('w', 1, 0, 'failed');
    // 背景补齐：合成中不行；三视图生成中、另一张背景还在生成都可以
    expect(retryCheck([bd, task('w', 1, 1, 'running')], 'w', 'backdrop', 1, 0)).toEqual({ ok: false, reason: '正在合成这一轮候选，等结束后再生成背景' });
    expect(retryCheck([bd, viewTask('w', 'front', 'a', 'running')], 'w', 'backdrop', 1, 0)).toEqual({ ok: true, attempt: 2 });
    expect(retryCheck([bd, task('w', 1, 1, 'running', 1, 'backdrop')], 'w', 'backdrop', 1, 0)).toEqual({ ok: true, attempt: 2 });
    // 合成补齐：三视图生成中不行；另一张候选还在生成、背景在生成都可以（背景换了，批准会失效，在 retrySlot 里挡）
    expect(retryCheck([sc, viewTask('w', 'side', 'a', 'running')], 'w', 'scene', 1, 0)).toEqual({ ok: false, reason: '三视图还在生成' });
    expect(retryCheck([sc, task('w', 1, 1, 'running')], 'w', 'scene', 1, 0)).toEqual({ ok: true, attempt: 2 });
    expect(retryCheck([sc, task('w', 2, 0, 'running', 1, 'backdrop')], 'w', 'scene', 1, 0)).toEqual({ ok: true, attempt: 2 });
    // 别的作品在生成不算
    expect(crossBusy([task('x', 1, 0, 'running')], 'w', 'backdrop')).toBeNull();
  });

  it('这一张最后一次按 attempt 找，不按数组顺序（评审第 11 条）', () => {
    const second = { ...task('w', 1, 0, 'failed', 2), error: '第二次：超时' };
    const first = { ...task('w', 1, 0, 'failed', 1), error: '第一次：内容被拦截' };
    expect(lastSlotTask([second, first], 'w', 'scene', 1, 0)?.error).toBe('第二次：超时');
    expect(lastSlotTask([first, second], 'w', 'scene', 1, 0)?.error).toBe('第二次：超时');
    expect(lastSlotTask([first], 'w', 'scene', 1, 1)).toBeUndefined();
  });
});

describe('生成中按类型分开（技术写法 13.6）', () => {
  it('三视图、背景、合成各自判断；任一种在生成都算忙', () => {
    const tasks = [viewTask('w', 'front', 'a', 'running'), task('w', 1, 0, 'succeeded'), task('x', 1, 0, 'running', 1, 'backdrop')];
    expect(busyOf(tasks, 'w')).toEqual({ views: true, backdrop: false, scene: false });
    expect(busyOf(tasks, 'x')).toEqual({ views: false, backdrop: true, scene: false });
    expect(generating(tasks, 'w', 'scene')).toBe(false);
    expect(anyBusy(busyOf(tasks, 'w'))).toBe(true);
    expect(anyBusy(busyOf([], 'w'))).toBe(false);
  });

  it('每轮两张：合成两张候选，背景两张选一张', () => {
    expect(slotsOf('scene')).toEqual([0, 1]);
    expect(slotsOf('backdrop')).toEqual([0, 1]);
  });
});

describe('结果', () => {
  it('两项都满意才算通过；按轮次取结果并按张排序', () => {
    expect(passed(result('w', 1, 0, { real: 'ok', style: 'ok' }))).toBe(true);
    expect(passed(result('w', 1, 0, { real: 'ok', style: 'none' }))).toBe(false);
    const rs = [result('w', 1, 1), result('w', 2, 0), result('w', 1, 0)];
    expect(roundResults(rs, 'w', 1).map((r) => r.slot)).toEqual([0, 1]);
  });
});
