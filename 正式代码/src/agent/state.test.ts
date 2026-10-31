import { describe, expect, it } from 'vitest';
import { BUILTIN_SCENES } from '@/config/scenes';
import { CHAT_MODELS } from '@/config/models';
import { current, currentBasis, promptedWork, readyWork } from '@/test/fixtures';
import { setRatio, suggestInfo } from '@/domain/work';
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
});
