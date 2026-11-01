import { beforeEach, describe, expect, it } from 'vitest';
import { describeStorageError, getSaveStatus, resetSaveStatus, tracked } from './save';

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

beforeEach(() => resetSaveStatus());

describe('保存状态（AC-01.4）', () => {
  it('失败时说明原因，可重试；重试成功后恢复为已保存', async () => {
    let fail = true;
    const op = async () => {
      if (fail) throw quota();
      return 'ok';
    };
    await expect(tracked('work:1', op)).rejects.toThrow('quota');
    const s = getSaveStatus();
    expect(s).toMatchObject({ state: 'error', message: '浏览器存储空间不足，内容没有保存' });
    fail = false;
    if (s.state !== 'error') throw new Error('应为失败状态');
    await s.retry();
    expect(getSaveStatus().state).toBe('saved');
  });

  it('别的写入成功不会掩盖这次失败', async () => {
    await expect(tracked('work:1', async () => Promise.reject(quota()))).rejects.toThrow();
    await tracked('work:2', async () => 'ok');
    expect(getSaveStatus().state).toBe('error');
    await tracked('work:1', async () => 'ok');
    expect(getSaveStatus().state).toBe('saved');
  });

  it('写入进行中显示保存中', async () => {
    let release!: () => void;
    const p = tracked('work:1', () => new Promise<void>((r) => (release = r)));
    expect(getSaveStatus().state).toBe('saving');
    release();
    await p;
    expect(getSaveStatus().state).toBe('saved');
  });

  it('识别 Dexie 包装过的存储空间不足', () => {
    expect(describeStorageError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(
      '浏览器存储空间不足，内容没有保存',
    );
    expect(describeStorageError(new Error('坏了'))).toBe('保存失败：坏了');
  });
});
