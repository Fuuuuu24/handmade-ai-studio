import { describe, expect, it } from 'vitest';
import { result, task, viewTask } from '@/test/fixtures';
import { anyBusy, busyOf, generating, passed, retryCheck, roundResults, slotsOf, slotState } from './generation';

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
    expect(retryCheck(tasks, 'w', 'backdrop', 1, 0)).toEqual({ ok: false, reason: '这一张已经成功了' });
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
