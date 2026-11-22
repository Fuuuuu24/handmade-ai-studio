import { describe, expect, it } from 'vitest';
import { CHAT_MODELS } from '@/config/models';
import { listedBuiltins } from '@/config/backdrops';
import { deriveContext } from '@/client/work-store';
import { refOfBackdrop, refOfBuiltin } from '@/domain/backdrops';
import type { Asset, Work, WorkState } from '@/domain/types';
import { approveScene, chooseCandidate, confirmSummary, draftSummary, editSummary, reviseFrom, setRatio, startSceneRound, suggestInfo } from '@/domain/work';
import { backdrop, backdropPromptedWork, backdropWork, product, promptedWork, readyWork, result, stateOf, task, upload, view } from '@/test/fixtures';
import { factsOf } from '@/domain/handoff';
import { setInfo } from '@/domain/work';
import { stateSummary } from './state';

const library = listedBuiltins().map((b) => refOfBuiltin(b.id)!);

const summarize = (work: Work, assets: readonly Asset[] = [], extra: Partial<WorkState> = {}, more: { photoLabels?: string[] } = {}) =>
  stateSummary({ ...deriveContext(stateOf(work, assets, extra)), library, chatModel: CHAT_MODELS[0], imageModelLabel: 'Seedream 5.0 Lite', ...more });

describe('stateSummary（技术写法 13.12）', () => {
  it('写明流程和步骤顺序：首页开始、套用模板各自的顺序', () => {
    const { work, assets } = readyWork();
    expect(summarize(work, assets)).toContain('流程：首页开始（商品 → 信息 → 背景 → 摆放 → 出图）');
    expect(summarize({ ...work, flow: 'template' }, assets)).toContain('流程：套用模板（背景 → 商品 → 信息 → 摆放 → 出图）');
  });

  it('照片和三视图逐个角度写明：缺照片、还没生成、待确认、已确认、生成中、失败', () => {
    const w = readyWork().work;
    const front = upload(w.id, 'front');
    const side = upload(w.id, 'side');
    const unsorted = upload(w.id, 'unsorted');
    const text = summarize(w, [front, side, unsorted, view(front, { confirmed: false })]);
    expect(text).toContain('照片：正面有、侧面有、背面缺；细节 0 张；未分类 1 张，要用户在「商品」里选类型（你可以建议，不能代选）');
    expect(text).toContain('三视图：正面待用户对照原图确认；侧面还没生成；背面缺照片');
    const all = product(w.id);
    expect(summarize(w, all)).toContain('三视图：正面已确认；侧面已确认；背面已确认');
  });

  it('区分已确认的信息和待确认的建议；核心信息建议没处理时写明现在写不了合成提示词', () => {
    const { work, assets } = readyWork();
    const text = summarize(suggestInfo(work, 'keep', '叶脉纹不能改'), assets);
    expect(text).toContain('- 材料：黄铜镀金（已确认）');
    expect(text).toContain('- 不能改的细节：未填；你的建议「叶脉纹不能改」待用户确认');
    expect(text).toContain('写合成提示词前：还有 1 条信息建议没处理：不能改的细节；现在用 draft_prompt 会被拒绝');
    expect(text).toContain('批准前提醒（不挡批准）');
  });

  it('用模板：写明选定的内置模板、无参数，以及模板库里可选的背景图和编号', () => {
    const { work, assets } = readyWork();
    const text = summarize(work, assets);
    expect(text).toContain('背景做法：用模板库里的');
    expect(text).toContain('选定的背景图：雨后清晨（builtin:moss@1，内置模板）；参数：示意模板，无参数（描述时按你看到的背景图）');
    expect(text).toContain('模板库里可选的背景图（use_backdrop 用编号）：builtin:moss@1 雨后清晨（内置模板，图还没提供，用色块示意；示意模板，无参数');
    expect(text).not.toContain('背景风格');
    expect(text).toContain('合成批准前还缺：合成提示词还没写');
  });

  it('自己生成：写明共创、背景风格、背景提示词和背景批准；候选待用户选定、不能代选', () => {
    const w = { ...backdropPromptedWork(), backdropRound: 1 };
    const cands = [backdrop(w.id, 1, 0), backdrop(w.id, 1, 1)];
    const text = summarize(w, [], { backdrops: cands });
    expect(text).toContain('背景做法：自己生成');
    expect(text).toContain('共创总结（用户已确认）：表达「雨后青苔」');
    expect(text).toContain('- 色调：雨后苔绿（用户在画布上改的）');
    expect(text).toContain('背景提示词：有效');
    expect(text).toContain(`背景 1：已生成（${cands[0].id}）`);
    expect(text).toContain('选哪张要用户在画布上点「用这张」，你不能代选');
    expect(text).toContain('背景批准前还缺：无，可以请用户批准（request_approval，kind=backdrop）');
    const picked = chooseCandidate(w, cands[1].id);
    const after = summarize(picked, [], { backdrops: cands, backdrop: refOfBackdrop(cands[1]) });
    expect(after).toContain('（背景图已选定，以背景图的参数为准，不能改；想改要用户先点「重新设计背景」）');
    expect(after).toContain('选定的背景图：第 1 轮背景 2');
    expect(after).not.toContain('背景批准前还缺');
  });

  it('用户改过小间起草的总结：逐项写明草稿和用户的版本，以用户的为准（BC-003）', () => {
    const w = draftSummary(backdropWork(), { express: '像退潮后的海边早晨', feel: '清透', avoid: '' });
    const text = summarize(confirmSummary(editSummary(w, { express: '清透、安静，克制的海岸感', feel: '清透', avoid: '' })));
    expect(text).toContain('表达：你写的「像退潮后的海边早晨」，用户改成「清透、安静，克制的海岸感」');
  });

  it('写明合成参考图的顺序；提示词过期的原因', () => {
    const { work, assets } = promptedWork();
    const text = summarize(setRatio(work, '3:4'), assets);
    expect(text).toContain('合成参考图：第 1 张是选定的背景图，第 2—4 张是正面、侧面、背面三视图；原图和细节照不进合成');
    expect(text).toContain('合成提示词：已过期，写完后改了：比例，需要重写');
  });

  it('用户已批准、这一轮正在生成：写明不用再批准，不把「已有任务在生成中」当批准缺项（BC-009）', () => {
    const { work, assets } = promptedWork();
    const a = approveScene(stateOf(work, assets));
    if (!a.ok) throw new Error('应当可以批准');
    const s = startSceneRound(stateOf(a.work, assets, { approval: a.approval }), a.approval);
    if (!s.ok) throw new Error('应当可以生成');
    const text = summarize(s.work, assets, { approval: s.approval, tasks: [task(work.id, 1, 0, 'running')] });
    expect(text).toContain('合成批准：用户已经批准了第 1 版，第 1 轮正在生成；不需要再请用户批准');
    expect(text).not.toContain('合成批准前还缺');
    expect(text).toContain('候选 1：生成中');
  });

  it('从某张结果修改时：写明问题出在背景时回背景这一步', () => {
    const { work, assets } = promptedWork();
    const a = approveScene(stateOf(work, assets));
    if (!a.ok) throw new Error('应当可以批准');
    const r = { ...result(work.id, 1, 0), issues: ['背景'] };
    const text = summarize(reviseFrom({ ...a.work, round: 1 }, r, a.approval), assets, { results: [r] });
    expect(text).toContain('正在从第 1 轮候选 1 修改（用户指出的问题：背景）');
    expect(text).toContain('请用户回「背景」换一张或重新生成');
  });

  it('写明上次交接是哪一步，以及之后的变化（AC-11.3b）', () => {
    const { work, assets } = readyWork();
    const handed = { ...work, lastHandoff: { step: 'info' as const, at: 1, facts: factsOf(stateOf(work, assets)) } };
    expect(summarize(handed, assets)).toContain('上次交接：信息；之后有这些变化（你自己用工具改的也算在内）：没有');
    expect(summarize(setInfo(handed, 'size', '5cm'), assets)).toContain('尺寸：长 4.5cm → 5cm');
  });

  it('写明这次附上的图各是什么，以及对话模型能否看图', () => {
    const { work, assets } = readyWork();
    const text = summarize(work, assets, {}, { photoLabels: ['正面三视图', '选定的背景图「雨后清晨」'] });
    expect(text).toContain('这次附上的图：1. 正面三视图；2. 选定的背景图「雨后清晨」');
    expect(text).toContain('当前对话模型：Qwen 3.8 Flash（能看图）');
  });
});
