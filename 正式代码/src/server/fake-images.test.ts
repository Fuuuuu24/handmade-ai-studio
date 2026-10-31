import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFake, submitFake } from './fake-images';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('假生图网关（只给开发和测试用）', () => {
  it('排队 → 生成中 → 完成，状态按时间推进', () => {
    const t = submitFake('一件手作耳饰', '3:4');
    expect(getFake(t.id).status).toBe('pending');
    vi.advanceTimersByTime(2000);
    expect(getFake(t.id).status).toBe('in_progress');
    vi.advanceTimersByTime(3000);
    expect(getFake(t.id)).toMatchObject({ status: 'completed', output: [{ index: 0 }] });
  });

  it('「失败一张」只让同一段提示词第一次提交的那张失败；「全部失败」每张都失败', () => {
    const prompt = '一件手作耳饰【测试：失败一张】';
    const a = submitFake(prompt, '1:1');
    const b = submitFake(prompt, '1:1');
    const all = submitFake('耳饰【测试：全部失败】', '1:1');
    const again = submitFake('耳饰【测试：全部失败】', '1:1');
    vi.advanceTimersByTime(5000);
    expect(getFake(a.id)).toMatchObject({ status: 'failed', error: { code: 'image_not_generated' } });
    expect(getFake(b.id).status).toBe('completed');
    expect(getFake(all.id).status).toBe('failed');
    expect(getFake(again.id).status).toBe('failed');
  });

  it('不认识的任务编号如实报错', () => {
    expect(() => getFake('fake_nope')).toThrow('假网关里没有这个任务');
  });
});
