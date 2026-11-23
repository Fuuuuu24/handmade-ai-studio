import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 浏览器里的图片处理在 Node 里没有，换成固定值
vi.mock('./images', () => ({
  // 按文件大小区分是哪张图：原图 100 字节，三视图 80，背景图 60，生成结果 3
  referenceDataUrl: vi.fn(async (blob: Blob) => `data:image/jpeg;base64,${blob.size}`),
  prepareDerived: vi.fn(async (blob: Blob) => ({ blob, thumb: blob, width: 1024, height: 1024 })),
}));

import { GENERATION } from '@/config/budget';
import { db, useTestDb } from '@/data/db';
import { addUpload, confirmView, getSceneApproval, getWork, listAssets, listResults, listTasks, listWorkBackdrops, putTask, saveBackdropResult, saveViewResult, saveWork } from '@/data/repo';
import type { ViewAngle } from '@/domain/types';
import { newId } from '@/domain/util';
import { refOfBackdrop } from '@/domain/backdrops';
import { chooseBackdrop, reviseFrom, writePrompt } from '@/domain/work';
import { backdrop, backdropPromptedWork, readyWork, task, viewTask } from '@/test/fixtures';
import { approveAndGenerate, approveAndGenerateBackdrop, generateViews, retrySlot } from './generation';
import { loadContext, mutateWork } from './work-store';

const bytes = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const img = (n: number) => ({ blob: bytes(n), thumb: bytes(10), width: 1600, height: 1200 });
const ANGLES: ViewAngle[] = ['front', 'side', 'back'];

// 三张原图（100 字节），可选再加确认过的三视图（80 字节）
async function seedPhotos(workId: string, withViews: boolean) {
  for (const k of ANGLES) {
    const p = await addUpload(workId, k, img(100));
    if (withViews) await confirmView(await saveViewResult(viewTask(workId, k, p.id, 'succeeded'), p, k, img(80)));
  }
}

// 就绪并写好合成提示词：三视图确认了，背景用别的作品沉淀进模板库的一张（60 字节）
async function seedReady() {
  const { work } = readyWork();
  await saveWork(work);
  await seedPhotos(work.id, true);
  const bd = backdrop('work_other', 1, 0, { savedAt: 1 });
  await saveBackdropResult({ ...task('work_other', 1, 0, 'succeeded', 1, 'backdrop'), id: bd.taskId }, bd, bytes(60), bytes(6));
  await mutateWork(work.id, (c) => chooseBackdrop(c.work, refOfBackdrop(bd)));
  const ctx = await loadContext(work.id);
  await saveWork(writePrompt(ctx.work, 'scene', '第 1 张是背景图，第 2—4 张是三视图……', ctx.basis));
  return { workId: work.id, backdrop: bd };
}

type ContentBehavior = () => Promise<Response>;

// 假的服务端接口：提交成功、查询即完成，取回图片的行为由每个测试指定；记下每次提交的内容
function stubServer(content: ContentBehavior = async () => jpeg()) {
  let n = 0;
  const calls = { content: 0, bodies: [] as { kind: string; prompt: string; ratio: string; images: string[] }[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/images' && init?.method === 'POST') {
        n += 1;
        calls.bodies.push(JSON.parse(String(init.body)));
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

const jpeg = () => new Response(bytes(3), { status: 200 });

// 推进轮询：每次走过一个查询间隔，直到全部结束
async function settle(workId: string) {
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(GENERATION.pollMs);
    const tasks = (await listTasks(workId)).filter((t) => t.workId === workId);
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

describe('合成：取回图片（图片已生成、已扣费）', () => {
  it('遇到临时网络错误会再试，取回后存下结果', async () => {
    let failures = 2;
    const calls = stubServer(async () => {
      if (failures-- > 0) throw new TypeError('fetch failed');
      return jpeg();
    });
    const { workId } = await seedReady();
    expect(await approveAndGenerate(workId)).toEqual({ ok: true, round: 1 });
    const tasks = await settle(workId);
    expect(tasks.filter((t) => t.kind === 'scene').map((t) => t.status)).toEqual(['succeeded', 'succeeded']);
    expect(await listResults(workId)).toHaveLength(2);
    expect(calls.content).toBe(4); // 第一张试了 3 次，第二张 1 次
  });

  it('一直取不回就判失败，如实说明生成好了但取回失败；不超过网关的下载次数', async () => {
    const calls = stubServer(async () => Response.json({ error: { code: 'internal_error', message: '网关内部错误' } }, { status: 502 }));
    const { workId } = await seedReady();
    await approveAndGenerate(workId);
    const tasks = (await settle(workId)).filter((t) => t.kind === 'scene');
    expect(tasks.every((t) => t.status === 'failed')).toBe(true);
    expect(tasks[0].error).toContain('生成好了，但取回或保存图片失败');
    expect(calls.content).toBe(2 * GENERATION.downloadTries);
    expect(await listResults(workId)).toEqual([]);
  });

  it('不是临时错误（比如结果已过期）不重试', async () => {
    const calls = stubServer(async () => Response.json({ error: { code: 'artifact_expired', message: '结果已过期' } }, { status: 410 }));
    const { workId } = await seedReady();
    await approveAndGenerate(workId);
    expect((await settle(workId)).filter((t) => t.kind === 'scene').every((t) => t.status === 'failed')).toBe(true);
    expect(calls.content).toBe(2);
  });
});

describe('合成的参考图（AC-02.3a）', () => {
  it('第 1 张是背景图，后面是三张三视图（正面、侧面、背面）；原图不进合成', async () => {
    const calls = stubServer();
    const { workId } = await seedReady();
    await approveAndGenerate(workId);
    await settle(workId);
    expect(calls.bodies.map((b) => [b.kind, b.ratio, b.images])).toEqual([
      ['scene', '1:1', ['data:image/jpeg;base64,60', 'data:image/jpeg;base64,80', 'data:image/jpeg;base64,80', 'data:image/jpeg;base64,80']],
      ['scene', '1:1', ['data:image/jpeg;base64,60', 'data:image/jpeg;base64,80', 'data:image/jpeg;base64,80', 'data:image/jpeg;base64,80']],
    ]);
  });

  it('从某张结果修改：新结果记为它的子版本，参考图仍是背景图和三视图（v0.6 取消房间参考）', async () => {
    const calls = stubServer();
    const { workId } = await seedReady();
    await approveAndGenerate(workId);
    await settle(workId);
    const first = (await listResults(workId)).find((r) => r.slot === 0)!;
    const approval = (await getSceneApproval(first.approvalId))!;
    await mutateWork(workId, (c) => reviseFrom(c.work, first, approval, c.backdrops));
    await mutateWork(workId, (c) => writePrompt(c.work, 'scene', '只把构图改成主体偏一侧', c.basis));
    expect(await approveAndGenerate(workId)).toEqual({ ok: true, round: 2 });
    await settle(workId);
    expect(calls.bodies[2].images).toEqual(calls.bodies[0].images);
    const second = (await listResults(workId)).filter((r) => r.round === 2);
    expect(second.map((r) => r.parentId)).toEqual([first.id, first.id]);
  });

  it('背景图在本地找不到时，这一轮如实失败，不悄悄只带三视图', async () => {
    const calls = stubServer();
    const { workId, backdrop: bd } = await seedReady();
    await db().blobs.delete(bd.blobId);
    await approveAndGenerate(workId);
    const tasks = (await settle(workId)).filter((t) => t.kind === 'scene');
    expect(tasks.map((t) => t.error)).toEqual([
      `背景图「${bd.name}」在本地找不到了（可能清理过浏览器数据）`,
      `背景图「${bd.name}」在本地找不到了（可能清理过浏览器数据）`,
    ]);
    expect(calls.bodies).toHaveLength(0);
  });
});

describe('三视图（技术写法 13.3）', () => {
  it('每个角度一个任务：参考图是这个角度的原图，再加正面原图；结果是还没确认的三视图，原图不动，不算合成轮次', async () => {
    const calls = stubServer();
    const { work } = readyWork();
    await saveWork(work);
    await seedPhotos(work.id, false);
    expect(await generateViews(work.id)).toEqual({ ok: true, angles: ['front', 'side', 'back'] });
    const tasks = (await settle(work.id)).sort((a, b) => ANGLES.indexOf(a.view!) - ANGLES.indexOf(b.view!));
    expect(tasks.map((t) => [t.kind, t.view, t.status, t.sourceAssetIds?.length])).toEqual([
      ['view', 'front', 'succeeded', 1],
      ['view', 'side', 'succeeded', 2],
      ['view', 'back', 'succeeded', 2],
    ]);
    expect(calls.bodies.map((b) => [b.kind, b.ratio, b.images.length])).toEqual([
      ['view', '1:1', 1],
      ['view', '1:1', 2],
      ['view', '1:1', 2],
    ]);
    expect(calls.bodies[1].prompt).toContain('第 2 张是它的正面照片');
    expect(calls.bodies[0].prompt).toContain('纯白背景');
    const assets = await listAssets(work.id);
    const views = assets.filter((a) => a.origin === 'view').sort((a, b) => ANGLES.indexOf(a.view!) - ANGLES.indexOf(b.view!));
    expect(views.map((v) => [v.view, v.confirmed, assets.find((p) => p.id === v.parentId)?.kind])).toEqual([
      ['front', false, 'front'],
      ['side', false, 'side'],
      ['back', false, 'back'],
    ]);
    expect(tasks.map((t) => t.viewAssetId)).toEqual(views.map((v) => v.id));
    const saved = (await getWork(work.id))!;
    expect(saved.round).toBe(0);
    expect(saved.costUSD).toBeCloseTo(0.09, 10);
  });

  it('缺照片时拒绝，不提交；已有三视图的角度不重复生成', async () => {
    const calls = stubServer();
    const { work } = readyWork();
    await saveWork(work);
    await addUpload(work.id, 'front', img(100));
    expect(await generateViews(work.id)).toEqual({ ok: false, reason: '还缺侧面、背面照片，三张都有才能生成三视图' });
    expect(calls.bodies).toHaveLength(0);
    await addUpload(work.id, 'side', img(100));
    await addUpload(work.id, 'back', img(100));
    await generateViews(work.id, ['side']);
    await settle(work.id);
    expect(await generateViews(work.id)).toEqual({ ok: true, angles: ['front', 'back'] });
  });
});

describe('背景图（技术写法 13.4）', () => {
  it('批准后生成两张不带参考图的背景（3:4），存成还没沉淀的背景图，记下方案参数；不替用户选定', async () => {
    const calls = stubServer();
    const w = backdropPromptedWork();
    await saveWork(w);
    expect(await approveAndGenerateBackdrop(w.id)).toEqual({ ok: true, round: 1 });
    await settle(w.id);
    expect(calls.bodies.map((b) => [b.kind, b.ratio, b.images, b.prompt])).toEqual([
      ['backdrop', '3:4', [], w.backdropPrompt!.text],
      ['backdrop', '3:4', [], w.backdropPrompt!.text],
    ]);
    const list = (await listWorkBackdrops(w.id)).sort((a, b) => a.slot - b.slot);
    expect(list.map((b) => [b.round, b.slot, b.savedAt, b.ratio])).toEqual([
      [1, 0, null, '3:4'],
      [1, 1, null, '3:4'],
    ]);
    expect(list[0].params).toEqual({ tone: '雨后苔绿', background: '手工纸', light: '清冷晨光', props: '', bannedBackdrop: '' });
    const saved = (await getWork(w.id))!;
    expect([saved.backdropRound, saved.backdropId, saved.round]).toEqual([1, null, 0]);
  });

  it('一张失败后可以补齐；批准后背景方案改过就不能补', async () => {
    let first = true;
    stubServer(async () => {
      if (first) {
        first = false;
        return Response.json({ error: { code: 'artifact_expired', message: '结果已过期' } }, { status: 410 });
      }
      return jpeg();
    });
    const w = backdropPromptedWork();
    await saveWork(w);
    await approveAndGenerateBackdrop(w.id);
    const failed = (await settle(w.id)).find((t) => t.status === 'failed')!;
    expect(await retrySlot(w.id, 'backdrop', 1, failed.slot!)).toEqual({ ok: true, round: 1 });
    await settle(w.id);
    expect(await listWorkBackdrops(w.id)).toHaveLength(2);
    expect(await retrySlot(w.id, 'backdrop', 1, failed.slot!)).toEqual({ ok: false, reasons: ['这一张已经成功了'] });
  });

  it('补齐被别的种类挡住：合成中不能补背景，三视图生成中不能补合成（评审第 7 条）', async () => {
    stubServer(async () => Response.json({ error: { code: 'artifact_expired', message: '结果已过期' } }, { status: 410 }));
    const w = backdropPromptedWork();
    await saveWork(w);
    await approveAndGenerateBackdrop(w.id);
    await settle(w.id);
    await putTask(task(w.id, 1, 0, 'running'));
    expect(await retrySlot(w.id, 'backdrop', 1, 0)).toEqual({ ok: false, reasons: ['正在合成这一轮候选，等结束后再生成背景'] });

    const { workId } = await seedReady();
    await approveAndGenerate(workId);
    await settle(workId);
    await putTask(viewTask(workId, 'front', 'asset_x', 'running'));
    expect(await retrySlot(workId, 'scene', 1, 0)).toEqual({ ok: false, reasons: ['三视图还在生成'] });
    expect((await listTasks(workId)).filter((t) => t.kind === 'scene')).toHaveLength(2);
  });
});
