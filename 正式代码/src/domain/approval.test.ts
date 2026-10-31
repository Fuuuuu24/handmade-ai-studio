import { describe, expect, it } from 'vitest';
import { current, currentBasis, promptedWork, readyWork, upload } from '@/test/fixtures';
import { approvalBlockers, approvalStatus, generationBlockers, promptStatus } from './approval';
import {
  approve,
  confirmAssets,
  editPrompt,
  markPromptChecked,
  markUnknown,
  newWork,
  resolvePromptSync,
  setInfo,
  setRatio,
  setRoute,
  setStyle,
  startRound,
} from './work';

const texts = (bs: { text: string }[]) => bs.map((b) => b.text);

describe('approvalBlockers', () => {
  it('新作品列出每一步缺什么', () => {
    const work = newWork({ imageModel: 'img-a', chatModel: 'chat-a', route: 'B' });
    const bs = approvalBlockers(work, [], currentBasis(work, []), false);
    expect(bs.map((b) => b.step)).toEqual(['asset', 'info', 'story', 'plan', 'plan']);
    expect(texts(bs)).toContain('品类、材料、尺寸还没填（不知道可以标「未知」）');
    expect(texts(bs)).toContain('风格还缺：色调、背景、光线、摆放、构图');
    expect(texts(bs)).toContain('提示词还没写');
  });

  it('信息标「未知」也算填好', () => {
    const { work: w0, assets } = promptedWork();
    const cleared = setInfo(w0, 'size', '');
    const mentionsSize = (w: typeof w0) =>
      texts(approvalBlockers(w, assets, currentBasis(w, assets), false)).some((t) => t.includes('尺寸'));
    expect(mentionsSize(cleared)).toBe(true);
    expect(mentionsSize(markUnknown(cleared, 'size', true))).toBe(false);
  });

  it('全部就绪且提示词有效时没有阻塞', () => {
    const { work, assets } = promptedWork();
    expect(approvalBlockers(work, assets, currentBasis(work, assets), false)).toEqual([]);
  });

  it('换到 A 路线要重新确认资产；确认了但没选白底图也不能批准', () => {
    const { work, assets } = promptedWork();
    const w = setRoute(work, 'A');
    expect(texts(approvalBlockers(w, assets, currentBasis(w, assets), false))).toContain('商品资产还没确认');
    const confirmed = confirmAssets(w);
    expect(texts(approvalBlockers(confirmed, assets, currentBasis(confirmed, assets), false))).toContain(
      '还没选定白底图',
    );
  });

  it('写完提示词后改比例：提示词过期，说明改了什么', () => {
    const { work, assets } = promptedWork();
    const w = setRatio(work, '3:4');
    expect(promptStatus(w, currentBasis(w, assets))).toEqual({ kind: 'stale', changed: ['比例'] });
    expect(texts(approvalBlockers(w, assets, currentBasis(w, assets), false))).toContain(
      '提示词写完后改了：比例，需要重写或确认',
    );
  });

  it('风格互相矛盾时不能批准', () => {
    const { work, assets } = promptedWork();
    let w = setStyle(work, 'props', '一小片苔藓', 'user');
    w = setStyle(w, 'banned', '苔藓', 'user');
    const b = currentBasis(w, assets);
    w = markPromptChecked(w, b);
    expect(texts(approvalBlockers(w, assets, b, false))).toContain('道具里有「苔藓」，但「禁止出现」也写了「苔藓」');
  });

  it('生成中不能批准', () => {
    const { work, assets } = promptedWork();
    expect(texts(approvalBlockers(work, assets, currentBasis(work, assets), true))).toEqual(['已有任务在生成中']);
  });
});

describe('手改提示词的核对（AC-07.2）', () => {
  it('手改后未核对不能批准；核对出矛盾仍不能批准', () => {
    const { work: w0, assets } = promptedWork();
    const w1 = editPrompt(w0, '我改过的提示词', currentBasis(w0, assets));
    expect(w1.prompt).toMatchObject({ edited: true, author: 'user', sync: 'unchecked' });
    expect(promptStatus(w1, currentBasis(w1, assets)).kind).toBe('unchecked');

    const w2 = resolvePromptSync(w1, ['提示词写了暖光，方案是清冷晨光'], currentBasis(w1, assets));
    expect(promptStatus(w2, currentBasis(w2, assets))).toEqual({
      kind: 'conflict',
      conflicts: ['提示词写了暖光，方案是清冷晨光'],
    });
  });

  it('小间把手改同步回风格后，提示词不被判为过期', () => {
    const { work: w0, assets } = promptedWork();
    let w = editPrompt(w0, '……暖调午后光……', currentBasis(w0, assets));
    w = setStyle(w, 'light', '暖调午后光', 'said'); // 小间按手改写回方案卡
    w = resolvePromptSync(w, [], currentBasis(w, assets));
    expect(promptStatus(w, currentBasis(w, assets))).toEqual({ kind: 'ok' });
  });

  it('小间不可用时，用户并排核对后自己标「已核对」', () => {
    const { work: w0, assets } = promptedWork();
    const w1 = editPrompt(w0, '我改过的提示词', currentBasis(w0, assets));
    const w2 = markPromptChecked(w1, currentBasis(w1, assets));
    expect(approvalBlockers(w2, assets, currentBasis(w2, assets), false)).toEqual([]);
  });
});

describe('approvalStatus / generationBlockers', () => {
  it('批准后改核心信息则失效；改选填的售价不失效', () => {
    const { work, assets } = promptedWork();
    const r = approve(work, assets, current(work, assets), false);
    if (!r.ok) throw new Error('应当可以批准');
    expect(approvalStatus(r.approval, current(r.work, assets))).toEqual({ kind: 'valid' });
    expect(approvalStatus(r.approval, current(setInfo(r.work, 'price', '99 元'), assets))).toEqual({ kind: 'valid' });
    expect(approvalStatus(r.approval, current(setInfo(r.work, 'material', '纯银'), assets))).toEqual({
      kind: 'stale',
      changed: ['商品信息'],
    });
  });

  it('换了参考图也让批准失效', () => {
    const { work, assets } = promptedWork();
    const r = approve(work, assets, current(work, assets), false);
    if (!r.ok) throw new Error('应当可以批准');
    const more = [...assets, upload(work.id, 'detail')];
    expect(approvalStatus(r.approval, current(r.work, more))).toMatchObject({ kind: 'stale', changed: ['参考图'] });
  });

  it('没有批准、批准已用过、正在生成时都不能发起生成', () => {
    const { work, assets } = promptedWork();
    expect(generationBlockers(null, current(work, assets), false)).toEqual(['方案还没批准']);
    const r = approve(work, assets, current(work, assets), false);
    if (!r.ok) throw new Error('应当可以批准');
    expect(generationBlockers(r.approval, current(r.work, assets), true)).toEqual(['已有任务在生成中']);
    const s = startRound(r.work, r.approval, current(r.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    expect(generationBlockers(s.approval, current(s.work, assets), false)).toEqual([
      '这版批准已经生成过一轮，要再生成需重新批准',
    ]);
  });
});

describe('readyWork 自检', () => {
  it('没写提示词时只缺提示词', () => {
    const { work, assets } = readyWork();
    expect(texts(approvalBlockers(work, assets, currentBasis(work, assets), false))).toEqual(['提示词还没写']);
  });
});
