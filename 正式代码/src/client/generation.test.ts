import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 浏览器里的图片处理在 Node 里没有，换成固定值
vi.mock('./images', () => ({
  referenceDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  imageSize: vi.fn(async () => ({ width: 1024, height: 1024 })),
}));

import { GENERATION } from '@/config/budget';
import { useTestDb } from '@/data/db';
import { addUpload, listResults, listTasks, saveWork } from '@/data/repo';
import { newId } from '@/domain/util';
import { writePrompt } from '@/domain/work';
import { readyWork } from '@/test/fixtures';
import { approveAndGenerate } from './generation';
import { loadContext } from './work-store';

const img = () => ({
  blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  width: 1600,
  height: 1200,
});

// 就绪并写好提示词的作品，参考图是真实写进测试库的那张
async function seedReady() {
  const { work } = readyWork();
  await saveWork(work);
  await addUpload(work.id, 'overall', img());
  const ctx = await loadContext(work.id);
  await saveWork(writePrompt(ctx.work, '一件手作耳饰，完整入框，四周留边距', ctx.basis));
  return work.id;
}

type ContentBehavior = () => Promise<Response>;

// 假的服务端接口：提交成功、查询即完成，取回图片的行为由每个测试指定
function stubServer(content: ContentBehavior) {
  let n = 0;
  const calls = { content: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/images' && init?.method === 'POST') {
        n += 1;
        return Response.json({ gatewayId: `g${n}`, status: 'pending', estUSD: 0.03, ledgerId: `led${n}` });
      }
      if (/\/content\?/.test(input)) {
        calls.content += 1;
        return content();
      }
      if (input.startsWith('/api/images/')) return Response.json({ status: 'completed', outputs: 1 });
      throw new Error(`没有模拟这个请求：${input}`);
    }),
  );
  return calls;
}

const jpeg = () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), { status: 200 });

// 推进轮询：每次走过一个查询间隔，直到两张都结束
async function settle(workId: string) {
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(GENERATION.pollMs);
    const tasks = await listTasks(workId);
    if (tasks.length && tasks.every((t) => t.status === 'succeeded' || t.status === 'failed')) return tasks;
  }
  throw new Error('任务一直没结束');
}

beforeEach(() => {
  useTestDb(newId('test'));
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('生成：取回图片（图片已生成、已扣费）', () => {
  it('遇到临时网络错误会再试，取回后存下结果', async () => {
    let failures = 2;
    const calls = stubServer(async () => {
      if (failures-- > 0) throw new TypeError('fetch failed');
      return jpeg();
    });
    const workId = await seedReady();
    expect(await approveAndGenerate(workId)).toEqual({ ok: true, round: 1 });
    const tasks = await settle(workId);
    expect(tasks.map((t) => t.status).sort()).toEqual(['succeeded', 'succeeded']);
    expect(await listResults(workId)).toHaveLength(2);
    expect(calls.content).toBe(4); // 第一张试了 3 次，第二张 1 次
  });

  it('一直取不回就判失败，如实说明生成好了但取回失败；不超过网关的下载次数', async () => {
    const calls = stubServer(async () => Response.json({ error: { code: 'internal_error', message: '网关内部错误' } }, { status: 502 }));
    const workId = await seedReady();
    await approveAndGenerate(workId);
    const tasks = await settle(workId);
    expect(tasks.every((t) => t.status === 'failed')).toBe(true);
    expect(tasks[0].error).toContain('生成好了，但取回或保存图片失败');
    expect(calls.content).toBe(2 * GENERATION.downloadTries);
    expect(await listResults(workId)).toEqual([]);
  });

  it('不是临时错误（比如结果已过期）不重试', async () => {
    const calls = stubServer(async () => Response.json({ error: { code: 'artifact_expired', message: '结果已过期' } }, { status: 410 }));
    const workId = await seedReady();
    await approveAndGenerate(workId);
    const tasks = await settle(workId);
    expect(tasks.every((t) => t.status === 'failed')).toBe(true);
    expect(calls.content).toBe(2);
  });
});
