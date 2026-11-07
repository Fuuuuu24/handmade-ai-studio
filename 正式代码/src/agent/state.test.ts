import { describe, expect, it } from 'vitest';
import { BUILTIN_SCENES } from '@/config/scenes';
import { CHAT_MODELS } from '@/config/models';
import { current, currentBasis, promptedWork, readyWork, result, task } from '@/test/fixtures';
import { approve, confirmSummary, draftSummary, editSummary, reviseFrom, setRatio, startRound, suggestInfo } from '@/domain/work';
import type { Work, Asset } from '@/domain/types';
import { stateSummary } from './state';

const scenes = BUILTIN_SCENES.map((s) => ({ id: s.id, name: s.name, desc: s.desc }));

const summarize = (work: Work, assets: Asset[]) =>
  stateSummary({
    work,
    assets,
    approval: null,
    tasks: [],
    results: [],
    scenes,
    basis: currentBasis(work, assets),
    current: current(work, assets),
    isGenerating: false,
    chatModel: CHAT_MODELS[0],
    imageModelLabel: 'Seedream 5.0 Lite',
  });

describe('stateSummary', () => {
  it('区分已确认的信息和待确认的建议', () => {
    const { work, assets } = readyWork();
    const text = summarize(suggestInfo(work, 'keep', '叶脉纹不能改'), assets);
    expect(text).toContain('- 材料：黄铜镀金（已确认）');
    expect(text).toContain('- 不能改的细节：未填；你的建议「叶脉纹不能改」待用户确认');
  });

  it('核心信息建议没处理：写成批准前提醒，不算批准缺项', () => {
    const { work, assets } = promptedWork();
    const text = summarize(suggestInfo(work, 'keep', '叶脉纹不能改'), assets);
    expect(text).toContain('批准前还缺：无，可以请用户批准');
    expect(text).toContain('批准前提醒（不挡批准）：还有 1 条信息建议没处理：不能改的细节；没接受的不会用于生成；请用户在信息页接受或忽略');
  });

  it('核心信息建议没处理：写明现在写不了提示词；只有选填项的建议时不写（UX-02）', () => {
    const { work, assets } = readyWork();
    expect(summarize(suggestInfo(work, 'keep', '叶脉纹不能改'), assets)).toContain(
      '写提示词前：还有 1 条信息建议没处理：不能改的细节，要等用户在信息页接受或忽略；现在用 draft_prompt 会被拒绝',
    );
    expect(summarize(suggestInfo(work, 'price', '198 元'), assets)).not.toContain('写提示词前');
  });

  it('从某张结果修改时：写明生成会带上那张结果作房间参考，以及参考图的顺序（BC-006）', () => {
    const { work, assets } = promptedWork();
    const a = approve(work, assets, current(work, assets), false);
    if (!a.ok) throw new Error('应当可以批准');
    const s = startRound(a.work, a.approval, current(a.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    const text = summarize(reviseFrom(s.work, result(work.id, 1, 1), s.approval), assets);
    expect(text).toContain(
      '房间参考图：生成时参考图依次是前 1 张商品图，最后一张（第 2 张）是这张结果，只用来参考房间、机位、光线和摆放位置；重写提示词时按规则写明各张图的用途',
    );
  });

  it('写明提示词过期的原因和批准前还缺什么', () => {
    const { work, assets } = promptedWork();
    const text = summarize(setRatio(work, '9:16'), assets);
    expect(text).toContain('提示词：已过期，写完后改了：比例，需要重写');
    expect(text).toContain('批准前还缺：提示词写完后改了：比例，需要重写或确认');
    expect(text).toContain('比例：9:16');
  });

  it('列出可用布景编号、风格来源和对话模型能否看图', () => {
    const { work, assets } = readyWork();
    const text = summarize(work, assets);
    expect(text).toContain('tpl-cream 午后书桌');
    expect(text).toContain('- 光线：清冷晨光（来自布景）');
    expect(text).toContain('当前对话模型：Qwen 3.8 Flash（能看照片）');
    expect(text).toContain('批准前还缺：提示词还没写');
  });

  it('用户已批准、这一轮正在生成：写明不用再批准，不把「已有任务在生成中」当批准缺项（BC-009）', () => {
    const { work, assets } = promptedWork();
    const a = approve(work, assets, current(work, assets), false);
    if (!a.ok) throw new Error('应当可以批准');
    const s = startRound(a.work, a.approval, current(a.work, assets), false);
    if (!s.ok) throw new Error('应当可以生成');
    const text = stateSummary({
      work: s.work,
      assets,
      approval: s.approval,
      tasks: [task(work.id, 1, 0, 'running'), task(work.id, 1, 1, 'running')],
      results: [],
      scenes,
      basis: currentBasis(s.work, assets),
      current: current(s.work, assets),
      isGenerating: true,
      chatModel: CHAT_MODELS[0],
      imageModelLabel: 'Seedream 5.0 Lite',
    });
    expect(text).toContain('批准：用户已经批准了当前方案（第 1 版），第 1 轮正在生成；不需要再请用户批准，等结果出来请用户验收');
    expect(text).not.toContain('批准前还缺');
    expect(text).toContain('第 1 轮生成：候选 1：生成中；候选 2：生成中');
  });

  it('用户改过小间起草的总结：逐项写明草稿和用户的版本，以用户的为准（BC-003）', () => {
    const { work, assets } = readyWork();
    const drafted = draftSummary(work, { express: '像退潮后的海边早晨', feel: '清透', avoid: '' });
    const edited = confirmSummary(editSummary(drafted, { express: '清透、安静，克制的海岸感', feel: '清透', avoid: '' }));
    const text = summarize(edited, assets);
    expect(text).toContain('共创总结（用户已确认）：表达「清透、安静，克制的海岸感」');
    expect(text).toContain('用户改过你起草的总结，以用户的为准，你草稿里被改掉或删掉的说法不要再写进风格和提示词：表达：你写的「像退潮后的海边早晨」，用户改成「清透、安静，克制的海岸感」');
    expect(summarize(drafted, assets)).not.toContain('用户改过你起草的总结');
  });
});
