import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 浏览器里的图片处理在 Node 里没有，换成固定值
vi.mock('./images', () => ({
  // 按文件大小区分是哪张图：商品照片 100 字节，生成结果 3 字节
  referenceDataUrl: vi.fn(async (blob: Blob) => `data:image/jpeg;base64,${blob.size}`),
  imageSize: vi.fn(async () => ({ width: 1024, height: 1024 })),
  prepareDerived: vi.fn(async (blob: Blob) => ({ blob, thumb: blob, width: 1024, height: 1024 })),
}));

import { GENERATION } from '@/config/budget';
import { db, useTestDb } from '@/data/db';
import { addUpload, getApproval, getWork, listAssets, listResults, listTasks, saveWork } from '@/data/repo';
import { newId } from '@/domain/util';
import { reviseFrom, setRoute, writePrompt } from '@/domain/work';
import { readyWork } from '@/test/fixtures';
import { approveAndGenerate, makeWhiteByGeneration } from './generation';
import { loadContext, mutateWork } from './work-store';

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

describe('从某张结果修改：带上那张结果作房间参考（BC-006）', () => {
  // 记下每次提交的参考图；提交即完成，取回的图片是 3 字节的 JPEG
  function recordBodies() {
    const bodies: { images: string[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === '/api/images' && init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({ gatewayId: `g${bodies.length}`, status: 'pending', estUSD: 0.03, ledgerId: `led${bodies.length}` });
        }
        if (/\/content\?/.test(input)) return jpeg();
        if (input.startsWith('/api/images/')) return Response.json({ status: 'completed', outputs: 1 });
        throw new Error(`没有模拟这个请求：${input}`);
      }),
    );
    return bodies;
  }

  // 生成第 1 轮，再从第 1 轮候选 1 修改、重写提示词
  async function reviseFirst(workId: string) {
    await approveAndGenerate(workId);
    await settle(workId);
    const first = (await listResults(workId)).find((r) => r.slot === 0)!;
    const approval = (await getApproval(first.approvalId))!;
    await mutateWork(workId, (c) => reviseFrom(c.work, first, approval));
    await mutateWork(workId, (c) => writePrompt(c.work, '前 1 张是商品照片，最后一张只参考房间和机位；只把墙面调浅', c.basis));
    return first;
  }

  it('第 2 轮的参考图是商品照片加被修改的那张结果，新结果记为它的子版本；第 1 轮只有商品照片', async () => {
    const bodies = recordBodies();
    const workId = await seedReady();
    const first = await reviseFirst(workId);
    expect(await approveAndGenerate(workId)).toEqual({ ok: true, round: 2 });
    await settle(workId);
    expect(bodies.map((b) => b.images)).toEqual([
      ['data:image/jpeg;base64,100'],
      ['data:image/jpeg;base64,100'],
      ['data:image/jpeg;base64,100', 'data:image/jpeg;base64,3'],
      ['data:image/jpeg;base64,100', 'data:image/jpeg;base64,3'],
    ]);
    const second = (await listResults(workId)).filter((r) => r.round === 2);
    expect(second.map((r) => r.parentId)).toEqual([first.id, first.id]);
  });

  it('被修改的那张结果图找不到时，这一轮如实失败，不悄悄只带商品照片', async () => {
    const bodies = recordBodies();
    const workId = await seedReady();
    const first = await reviseFirst(workId);
    await db().blobs.delete(first.blobId);
    await approveAndGenerate(workId);
    const tasks = (await settle(workId)).filter((t) => t.round === 2);
    expect(tasks.map((t) => [t.status, t.error])).toEqual([
      ['failed', '作为房间参考的那张结果找不到了，没法沿用它的房间'],
      ['failed', '作为房间参考的那张结果找不到了，没法沿用它的房间'],
    ]);
    expect(bodies).toHaveLength(2); // 只有第 1 轮提交过
  });
});

describe('白底图做法①：生图模型出白底', () => {
  it('派生一张白底图（记原图和做法），原图不动，不算生成轮次，也不自动选用', async () => {
    const calls: { body?: { prompt: string; ratio: string } } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === '/api/images' && init?.method === 'POST') {
          calls.body = JSON.parse(String(init.body));
          return Response.json({ gatewayId: 'g1', status: 'pending', estUSD: 0.03, ledgerId: 'led1' });
        }
        if (/\/content\?/.test(input)) return jpeg();
        if (input.startsWith('/api/images/')) return Response.json({ status: 'completed', outputs: 1 });
        throw new Error(`没有模拟这个请求：${input}`);
      }),
    );
    const workId = await seedReady();
    await saveWork(setRoute((await getWork(workId))!, 'A'));
    const [photo] = await listAssets(workId);
    expect(await makeWhiteByGeneration(workId, photo.id)).toEqual({ ok: true });
    const tasks = await settle(workId);
    expect(tasks).toMatchObject([{ kind: 'white', status: 'succeeded', sourceAssetId: photo.id }]);
    expect(calls.body?.ratio).toBe('1:1');
    expect(calls.body?.prompt).toContain('纯白背景');
    const assets = await listAssets(workId);
    const white = assets.find((a) => a.origin === 'white');
    expect(white).toMatchObject({ parentId: photo.id, method: 'generate', kind: 'overall' });
    expect(tasks[0].whiteAssetId).toBe(white!.id);
    expect(assets.find((a) => a.id === photo.id)?.removed).toBe(false);
    const work = (await getWork(workId))!;
    expect(work.round).toBe(0);
    expect(work.whiteChoice).toBeNull();
    expect(work.costUSD).toBeCloseTo(0.03, 10);
  });

  it('B 路线拒绝，不提交', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const workId = await seedReady();
    const [photo] = await listAssets(workId);
    expect(await makeWhiteByGeneration(workId, photo.id)).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
