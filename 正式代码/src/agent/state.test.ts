import { describe, expect, it } from 'vitest';
import { BUILTIN_SCENES } from '@/config/scenes';
import { CHAT_MODELS } from '@/config/models';
import { current, currentBasis, promptedWork, readyWork, task } from '@/test/fixtures';
import { approve, confirmSummary, draftSummary, editSummary, setRatio, startRound, suggestInfo } from '@/domain/work';
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
