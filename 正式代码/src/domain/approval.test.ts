import { describe, expect, it } from 'vitest';
import { current, currentBasis, promptedWork, readyWork, result, upload } from '@/test/fixtures';
import { approvalBlockers, approvalReminders, approvalStatus, generationBlockers, promptStatus, promptWriteBlocker } from './approval';
import {
  acceptSuggestion,
  approve,
  confirmAssets,
  dismissSuggestion,
  editPrompt,
  markPromptChecked,
  markUnknown,
  newWork,
  resolvePromptSync,
  reviseFrom,
  setInfo,
  setRatio,
  setRoute,
  setStyle,
  startRound,
  suggestInfo,
  writePrompt,
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

describe('approvalReminders（不挡批准的提醒，2026-11-06）', () => {
  it('核心信息有小间建议没处理：提醒列出是哪几项，但不挡批准', () => {
    const { work, assets } = promptedWork();
    const w = suggestInfo(suggestInfo(work, 'keep', '九颗珍珠，数量不能变'), 'material', '淡水珍珠、925 银');
    expect(texts(approvalReminders(w))).toEqual(['还有 2 条信息建议没处理：材料、不能改的细节；没接受的不会用于生成']);
    expect(approvalReminders(w)[0].step).toBe('info');
    expect(approvalBlockers(w, assets, currentBasis(w, assets), false)).toEqual([]);
    const r = approve(w, assets, current(w, assets), false);
    expect(r.ok).toBe(true);
  });

  it('接受或忽略之后不再提醒；售价、目标顾客这类选填项的建议不提醒', () => {
    const { work } = promptedWork();
    const w = suggestInfo(suggestInfo(work, 'keep', '九颗珍珠'), 'material', '淡水珍珠');
    expect(approvalReminders(dismissSuggestion(acceptSuggestion(w, 'keep'), 'material'))).toEqual([]);
    expect(approvalReminders(suggestInfo(work, 'price', '198 元'))).toEqual([]);
  });
});

describe('promptWriteBlocker（写提示词前先处理核心信息建议，UX-02）', () => {
  it('核心信息有小间建议没处理：写不了提示词，说明是哪几项', () => {
    const { work } = readyWork();
    const w = suggestInfo(suggestInfo(work, 'keep', '耳钩经小圆环连片'), 'material', '黄铜');
    expect(promptWriteBlocker(w)).toEqual({ step: 'info', text: '还有 2 条信息建议没处理：材料、不能改的细节' });
  });

  it('接受或忽略之后可以写；售价、目标顾客的建议不挡', () => {
    const { work } = readyWork();
    const w = suggestInfo(suggestInfo(work, 'keep', '耳钩经小圆环连片'), 'material', '黄铜');
    expect(promptWriteBlocker(dismissSuggestion(acceptSuggestion(w, 'keep'), 'material'))).toBeNull();
    expect(promptWriteBlocker(suggestInfo(suggestInfo(work, 'price', '198 元'), 'audience', '送礼的人'))).toBeNull();
  });

  it('为什么要挡：建议没处理时写的提示词，一接受就过期', () => {
    const { work, assets } = readyWork();
    const w = suggestInfo(work, 'keep', '耳钩经小圆环连片');
    const written = writePrompt(w, '一对黄铜耳饰……', currentBasis(w, assets));
    const accepted = acceptSuggestion(written, 'keep');
    expect(promptStatus(accepted, currentBasis(accepted, assets))).toEqual({ kind: 'stale', changed: ['商品信息'] });
  });
});

describe('从结果修改时带上那张结果作房间参考（BC-006）', () => {
  // 生成第 1 轮，再从候选 1 修改
  function revising() {
    const { work, assets } = promptedWork();
    const a = approve(work, assets, current(work, assets), false);
    if (!a.ok) throw new Error('应当可以批准');
    const s = startRound(a.work, a.approval, current(a.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    return { work: reviseFrom(s.work, result(work.id, 1, 0), s.approval), assets };
  }
  const roomBlocker = (bs: { text: string }[]) => texts(bs).filter((t) => t.includes('房间参考'));

  it('商品照片已经占满参考图上限时挡批准；少一张就可以；不在修改时不挡', () => {
    const { work, assets } = revising();
    const three = [...assets, upload(work.id, 'back'), upload(work.id, 'detail')];
    const four = [...three, upload(work.id, 'detail')];
    expect(roomBlocker(approvalBlockers(work, three, currentBasis(work, three), false))).toEqual([]);
    expect(roomBlocker(approvalBlockers(work, four, currentBasis(work, four), false))).toEqual([
      '这次要带上被修改的那张结果作房间参考，商品照片最多用 3 张，请先停用一张',
    ]);
    const { work: plain } = promptedWork();
    expect(roomBlocker(approvalBlockers(plain, four, currentBasis(plain, four), false))).toEqual([]);
  });

  it('修改后批准并开始生成：修改状态结束，但这版批准仍然有效（补齐失败的一张要用），并记着房间参考来自哪张', () => {
    const { work, assets } = revising();
    const w = writePrompt(work, '前 1 张是商品照片，最后一张只参考房间和机位；只把墙面调浅', currentBasis(work, assets));
    const a = approve(w, assets, current(w, assets), false);
    if (!a.ok) throw new Error('应当可以批准');
    expect(a.approval.parentResultId).toBe(work.revision!.fromResultId);
    const s = startRound(a.work, a.approval, current(a.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    expect(s.work.revision).toBeUndefined();
    expect(approvalStatus(s.approval, current(s.work, assets))).toEqual({ kind: 'valid' });
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
