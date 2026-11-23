import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from '@/data/db';
import { addUpload, confirmView, getBackdrop, getResult, getWork, listAssets, listEvents, putTask, saveBackdropResult, saveResult, saveViewResult, saveWork } from '@/data/repo';
import { verdictKey } from '@/domain/notices';
import type { AskAction, ViewAngle, Work } from '@/domain/types';
import { newId } from '@/domain/util';
import { newWork, setBackdropMode } from '@/domain/work';
import { backdrop, BUILTIN, result, task, viewTask } from '@/test/fixtures';
import { openAskFor, proxyConfirm } from './asks';
import { loadContext } from './work-store';

const img = () => ({
  blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  width: 1600,
  height: 1200,
});
const ANGLES: ViewAngle[] = ['front', 'side', 'back'];
const VIEWS: AskAction[] = ANGLES.map((angle) => ({ type: 'confirm_view', angle }));

// 三张原图，各有一张还没确认的三视图
async function seedViews(): Promise<Work> {
  const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
  await saveWork(w);
  for (const k of ANGLES) {
    const p = await addUpload(w.id, k, img());
    await saveViewResult(viewTask(w.id, k, p.id, 'succeeded'), p, k, img());
  }
  return w;
}

const confirmedAngles = async (workId: string) =>
  (await listAssets(workId))
    .filter((a) => a.origin === 'view' && a.confirmed)
    .map((a) => a.view)
    .sort();

// 用户在请求之后说的话（不含系统代发的交接和通知），由对话面板按消息顺序取
let said: string[] = [];
const after = () => said;

beforeEach(() => {
  useTestDb(newId('test'));
  said = [];
});

describe('问过再代点：三条核对（技术写法 14.4）', () => {
  it('没问过不能代点；问过但用户还没回复、原话找不到都不代点，请求留着', async () => {
    const w = await seedViews();
    expect(await proxyConfirm(w.id, '同意', undefined, after)).toEqual({ ok: false, reason: '没有在等用户回复的请求；要替用户点，先用 ask_confirm 问' });

    expect(await openAskFor(w.id, 'call_1', VIEWS)).toMatchObject({ ok: true });
    expect(await proxyConfirm(w.id, '同意', undefined, after)).toEqual({ ok: false, reason: '问过之后用户还没回复，等他回复了再说' });
    said = ['我再看看'];
    const r = await proxyConfirm(w.id, '同意', undefined, after);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toContain('找不到「同意」');
    expect(await confirmedAngles(w.id)).toEqual([]);
    expect((await getWork(w.id))?.asks?.call_1.state).toBe('waiting');
  });

  it('原话对上就代点：和画布按钮一样确认三视图，请求记下原话；试用事件记小间代点', async () => {
    const w = await seedViews();
    await openAskFor(w.id, 'call_1', VIEWS);
    said = ['好的，同意！'];
    const r = await proxyConfirm(w.id, '同意', undefined, after);
    expect(r.ok && r.done.map((i) => i.text)).toEqual(['正面三视图可以用', '侧面三视图可以用', '背面三视图可以用']);
    expect(await confirmedAngles(w.id)).toEqual(['back', 'front', 'side']);
    expect((await getWork(w.id))?.asks?.call_1).toMatchObject({ state: 'done', quote: '同意', done: [0, 1, 2] });
    const events = (await listEvents()).filter((e) => e.type === 'proxy');
    expect(events.map((e) => e.data)).toEqual(VIEWS.map(() => ({ action: 'confirm_view', by: 'agent' })));
    // 同一条请求不能再代点一次
    expect((await proxyConfirm(w.id, '同意', undefined, after)).ok).toBe(false);
  });

  it('卡片没放出来（中途停下了）：不代点，请求作废', async () => {
    const w = await seedViews();
    await openAskFor(w.id, 'call_1', VIEWS);
    const r = await proxyConfirm(w.id, '同意', undefined, () => null);
    expect(!r.ok && r.reason).toBe('卡片没放出来，用户没看到要点什么，这条请求作废了；请重新问');
    expect((await getWork(w.id))?.asks?.call_1.state).toBe('expired');
    expect(await confirmedAngles(w.id)).toEqual([]);
  });

  it('只同意一部分：只点那几样', async () => {
    const w = await seedViews();
    await openAskFor(w.id, 'call_1', VIEWS);
    said = ['正面和背面可以，侧面我再看看'];
    const r = await proxyConfirm(w.id, '正面和背面可以', [3, 1, 1], after);
    expect(r.ok && r.done.map((i) => i.text)).toEqual(['正面三视图可以用', '背面三视图可以用']);
    expect(await confirmedAngles(w.id)).toEqual(['back', 'front']);
    expect((await getWork(w.id))?.asks?.call_1.done).toEqual([0, 2]);
    expect(await proxyConfirm(w.id, '可以', [4], after)).toMatchObject({ ok: false });
  });

  it('问过之后用户自己点了一样：整条请求作废，什么都不代点', async () => {
    const w = await seedViews();
    await openAskFor(w.id, 'call_1', VIEWS);
    const front = (await listAssets(w.id)).find((a) => a.origin === 'view' && a.view === 'front')!;
    await confirmView(front);
    said = ['同意'];
    const r = await proxyConfirm(w.id, '同意', undefined, after);
    expect(!r.ok && r.reason).toBe('问过之后这些变了：正面三视图可以用。这条请求作废了，没有代点；请按现在的情况重新问');
    expect(await confirmedAngles(w.id)).toEqual(['front']);
    expect((await getWork(w.id))?.asks?.call_1).toMatchObject({ state: 'expired', reason: '问过之后这些变了：正面三视图可以用' });
  });

  it('再问一条，旧的作废；不能点的不放卡片', async () => {
    const w = await seedViews();
    await openAskFor(w.id, 'call_1', VIEWS.slice(0, 1));
    expect(await openAskFor(w.id, 'call_2', [{ type: 'confirm_summary' }])).toEqual({ ok: false, reasons: ['背景用的是模板库里的，没有共创总结要确认'] });
    expect((await getWork(w.id))?.asks?.call_1.state).toBe('waiting');
    await openAskFor(w.id, 'call_2', VIEWS.slice(1));
    const asks = (await getWork(w.id))?.asks;
    expect([asks?.call_1.state, asks?.call_2.state]).toEqual(['replaced', 'waiting']);
  });
});

describe('每样代点都和画布按钮用同一个函数', () => {
  it('验收：改两项，不再发验收通知；试用事件记 by: agent', async () => {
    const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
    await saveWork(w);
    const r = result(w.id, 1, 0);
    const t = { ...task(w.id, 1, 0, 'succeeded'), id: r.taskId };
    await saveResult(t, r, new Blob([new Uint8Array(3)], { type: 'image/jpeg' }));
    await openAskFor(w.id, 'call_1', [{ type: 'verdict', round: 1, candidate: 1, real: 'ok', style: 'bad' }]);
    said = ['对，就这样'];
    expect((await proxyConfirm(w.id, '就这样', undefined, after)).ok).toBe(true);
    const saved = (await getResult(r.id))!;
    expect(saved.verdict).toEqual({ real: 'ok', style: 'bad' });
    expect(saved.notifiedVerdict).toBe(verdictKey(saved));
    // 同一毫秒记下的两条，按时间排不出先后，按项排
    const verdicts = (await listEvents())
      .filter((e) => e.type === 'verdict')
      .map((e) => e.data)
      .sort((a, b) => String(a?.kind).localeCompare(String(b?.kind)));
    expect(verdicts).toEqual([
      { round: 1, slot: 0, kind: 'real', value: 'ok', by: 'agent' },
      { round: 1, slot: 0, kind: 'style', value: 'bad', by: 'agent' },
    ]);
  });

  it('背景：同一条请求里先选定第 1 张，再沉淀进模板库', async () => {
    const w = { ...setBackdropMode(newWork({ imageModel: 'img-a', chatModel: 'chat-a' }), 'generate'), backdropRound: 1 };
    await saveWork(w);
    const b = backdrop(w.id, 1, 0);
    await saveBackdropResult({ ...task(w.id, 1, 0, 'succeeded', 1, 'backdrop'), id: b.taskId }, b, new Blob(['a']), new Blob(['b']));
    await openAskFor(w.id, 'call_1', [
      { type: 'pick_backdrop', round: 1, candidate: 1 },
      { type: 'save_backdrop', name: '苔绿晨光' },
    ]);
    said = ['可以'];
    expect((await proxyConfirm(w.id, '可以', undefined, after)).ok).toBe(true);
    expect((await getWork(w.id))?.backdropId).toBe(b.id);
    expect(await getBackdrop(b.id)).toMatchObject({ name: '苔绿晨光', deletedAt: null });
    expect((await getBackdrop(b.id))?.savedAt).toBeGreaterThan(0);
  });

  it('只同意沉淀、没同意选定：要先选定，一样都没点成，请求留着', async () => {
    const w = { ...setBackdropMode(newWork({ imageModel: 'img-a', chatModel: 'chat-a' }), 'generate'), backdropRound: 1 };
    await saveWork(w);
    const b = backdrop(w.id, 1, 0);
    await saveBackdropResult({ ...task(w.id, 1, 0, 'succeeded', 1, 'backdrop'), id: b.taskId }, b, new Blob(['a']), new Blob(['b']));
    await openAskFor(w.id, 'call_1', [
      { type: 'pick_backdrop', round: 1, candidate: 1 },
      { type: 'save_backdrop', name: '苔绿晨光' },
    ]);
    said = ['沉淀可以'];
    const r = await proxyConfirm(w.id, '沉淀可以', [2], after);
    expect(!r.ok && r.reason).toContain('还没选定背景图');
    expect((await getBackdrop(b.id))?.savedAt).toBeNull();
    expect((await getWork(w.id))?.asks?.call_1.state).toBe('waiting');
  });

  it('流程二改自己生成背景：切到流程一，模板清掉', async () => {
    const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId: BUILTIN });
    await saveWork(w);
    await openAskFor(w.id, 'call_1', [{ type: 'switch_flow' }]);
    said = ['同意'];
    expect((await proxyConfirm(w.id, '同意', undefined, after)).ok).toBe(true);
    expect(await getWork(w.id)).toMatchObject({ flow: 'home', backdropMode: 'generate', backdropId: null });
  });

  it('东西没变但正在生成、暂时锁定：先不代点，请求留着', async () => {
    const w = await seedViews();
    const sug = { ...w, info: { ...w.info, material: { value: '', unknown: false, suggestion: { value: '925 银', at: 1 } } } };
    await saveWork(sug);
    await openAskFor(w.id, 'call_1', [{ type: 'accept_info', field: 'material' }]);
    await putTask(task(w.id, 1, 0, 'running', 1, 'backdrop'));
    said = ['同意'];
    const r = await proxyConfirm(w.id, '同意', undefined, after);
    expect(!r.ok && r.reason).toContain('现在点不了');
    expect((await loadContext(w.id)).work.info.material.value).toBe('');
    expect((await getWork(w.id))?.asks?.call_1.state).toBe('waiting');
  });
});
