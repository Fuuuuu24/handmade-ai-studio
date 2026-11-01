import { describe, expect, it } from 'vitest';
import { WHITE } from '@/config/white';
import { readyWork, task, upload, white } from '@/test/fixtures';
import type { Task } from './types';
import { makingWhite, whiteCheck, whiteChoiceValid, whitesOf } from './white';
import { chooseWhite, setRoute } from './work';

const whiteTask = (workId: string, sourceAssetId: string, status: Task['status']): Task => ({
  ...task(workId, 0, 0, status),
  kind: 'white',
  round: undefined,
  slot: undefined,
  sourceAssetId,
});

function aWork() {
  const { work, assets } = readyWork();
  return { work: setRoute(work, 'A'), assets, photo: assets[0] };
}

describe('白底图（PRD 4.3、AC-02.2）', () => {
  it('只在 A 路线、给在用的整体或背面原图做', () => {
    const { work, assets, photo } = aWork();
    expect(whiteCheck(work, assets, [], photo.id, false)).toEqual({ ok: true });
    expect(whiteCheck(setRoute(work, 'B'), assets, [], photo.id, false)).toMatchObject({ ok: false, reason: expect.stringContaining('原图路线') });
    const detail = upload(work.id, 'detail');
    expect(whiteCheck(work, [...assets, detail], [], detail.id, false)).toMatchObject({ ok: false, reason: expect.stringContaining('细节照') });
    const removed = upload(work.id, 'overall', { removed: true });
    expect(whiteCheck(work, [...assets, removed], [], removed.id, false).ok).toBe(false);
    const w = white(work.id, photo.id);
    expect(whiteCheck(work, [...assets, w], [], w.id, false).ok).toBe(false); // 不能拿白底图再做白底
  });

  it('生成中、同一张正在做、次数到上限时拒绝', () => {
    const { work, assets, photo } = aWork();
    expect(whiteCheck(work, assets, [], photo.id, true).ok).toBe(false);
    expect(whiteCheck(work, assets, [whiteTask(work.id, photo.id, 'running')], photo.id, false)).toEqual({ ok: false, reason: '这张照片的白底图正在做' });
    const used = Array.from({ length: WHITE.perAsset }, () => whiteTask(work.id, photo.id, 'failed'));
    expect(whiteCheck(work, assets, used, photo.id, false)).toMatchObject({ ok: false, reason: expect.stringContaining(`${WHITE.perAsset} 次`) });
    expect(whiteCheck(work, assets, used.slice(1), photo.id, false).ok).toBe(true);
  });

  it('白底任务不算「生成中」，但能单独看出正在做白底', () => {
    const { work, photo } = aWork();
    const tasks = [whiteTask(work.id, photo.id, 'running')];
    expect(makingWhite(tasks, work.id)).toBe(true);
    expect(makingWhite([whiteTask(work.id, photo.id, 'succeeded')], work.id)).toBe(false);
  });

  it('列出某张原图的白底图（不含停用的）；选用的白底图停用后选择失效', () => {
    const { work, assets, photo } = aWork();
    const a = white(work.id, photo.id);
    const b = { ...white(work.id, photo.id), removed: true };
    expect(whitesOf([...assets, a, b], photo.id).map((x) => x.id)).toEqual([a.id]);
    const chosen = chooseWhite(work, a.id);
    expect(chosen.assetsConfirmed).toBe(false); // 换了白底图要重新确认资产
    expect(whiteChoiceValid(chosen, [...assets, a])).toBe(true);
    expect(whiteChoiceValid(chosen, [...assets, { ...a, removed: true }])).toBe(false);
  });
});
