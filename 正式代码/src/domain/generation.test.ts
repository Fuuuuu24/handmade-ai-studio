import { describe, expect, it } from 'vitest';
import { result, task } from '@/test/fixtures';
import { generating, passed, retryCheck, roundResults, slotState } from './generation';

describe('补齐失败的一张（AC-08.5）', () => {
  it('没生成过、还在生成、已成功时都不能补齐', () => {
    expect(retryCheck([], 'w', 1, 0)).toEqual({ ok: false, reason: '这一张还没有生成过' });
    expect(retryCheck([task('w', 1, 0, 'running')], 'w', 1, 0)).toEqual({ ok: false, reason: '这一张还在生成中' });
    expect(retryCheck([task('w', 1, 0, 'succeeded')], 'w', 1, 0)).toEqual({ ok: false, reason: '这一张已经成功了' });
  });

  it('失败后可以补齐，次数到上限后不再允许', () => {
    const t1 = task('w', 1, 0, 'failed', 1);
    expect(retryCheck([t1], 'w', 1, 0, 2)).toEqual({ ok: true, attempt: 2 });
    const t2 = task('w', 1, 0, 'failed', 2);
    expect(retryCheck([t1, t2], 'w', 1, 0, 2)).toEqual({ ok: true, attempt: 3 });
    const t3 = task('w', 1, 0, 'failed', 3);
    expect(retryCheck([t1, t2, t3], 'w', 1, 0, 2)).toEqual({
      ok: false,
      reason: '这一张已经补齐过 2 次，先改方案再重新生成',
    });
  });

  it('只看同一作品、同一轮、同一张', () => {
    const tasks = [task('w', 1, 0, 'failed'), task('w', 1, 1, 'running'), task('x', 1, 0, 'succeeded')];
    expect(slotState(tasks, 'w', 1, 0)).toBe('failed');
    expect(slotState(tasks, 'w', 1, 1)).toBe('active');
    expect(slotState(tasks, 'w', 2, 0)).toBe('empty');
    expect(generating(tasks, 'w')).toBe(true);
    expect(generating(tasks, 'x')).toBe(false);
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
