import { describe, expect, it } from 'vitest';
import { backdrop, backdropPromptedWork, BUILTIN, product, promptedWork, readyWork, stateOf, upload, view } from '@/test/fixtures';
import { refOfBackdrop } from './backdrops';
import { changeText, diffFacts, factsOf, handoffBlocker, handoffText, nextStepOf } from './handoff';
import { sceneBasisOf } from './snapshot';
import { approveScene, chooseBackdrop, editPrompt, markUnknown, newWork, queueHandoff, setInfo, setStyle, suggestInfo } from './work';

describe('「下一步」交接（PRD AC-11.3a，技术写法 13.12）', () => {
  it('下一步按这件作品的流程排；出图没有下一步', () => {
    expect(nextStepOf('home', 'product')).toBe('info');
    expect(nextStepOf('home', 'backdrop')).toBe('placement');
    expect(nextStepOf('template', 'backdrop')).toBe('product');
    expect(nextStepOf('template', 'info')).toBe('placement');
    expect(nextStepOf('home', 'result')).toBeNull();
  });

  it('这一步做完才能点，不能点时写明缺什么', () => {
    const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
    const front = upload(w.id, 'front');
    expect(handoffBlocker(stateOf(w, [front]), 'product')).toBe('还缺侧面、背面照片');
    const all = product(w.id);
    expect(handoffBlocker(stateOf(w, [...all.slice(0, 5), { ...all[5], confirmed: false }]), 'product')).toBe('背面的三视图还没确认');
    expect(handoffBlocker(stateOf(w, all), 'product')).toBeNull();
    expect(handoffBlocker(stateOf(w), 'info')).toBe('品类、材料、尺寸还没填（不知道可以标「未知」）');
    expect(handoffBlocker(stateOf(w), 'backdrop')).toBe('还没选背景的做法');
    expect(handoffBlocker(stateOf(w), 'placement')).toBe('合成方案还没批准');
    const { work, assets } = readyWork();
    expect(handoffBlocker(stateOf(suggestInfo(work, 'keep', '两个圈不能变形'), assets), 'info')).toBe('还有 1 条信息建议没处理');
    expect(handoffBlocker(stateOf(work, assets), 'backdrop')).toBeNull();
  });

  it('背景：选了自家的背景图、总结回到草稿时，不管哪种做法都说「共创总结还没确认」（评审第 6 条）', () => {
    const w = backdropPromptedWork();
    const b = backdrop(w.id, 1, 0, { savedAt: 9 });
    const picked = chooseBackdrop(w, refOfBackdrop(b));
    const draft = { ...picked, story: { ...picked.story, summaryState: 'draft' as const } };
    expect(handoffBlocker(stateOf(picked, [], { backdrop: refOfBackdrop(b) }), 'backdrop')).toBeNull();
    expect(handoffBlocker(stateOf(draft, [], { backdrop: refOfBackdrop(b) }), 'backdrop')).toBe('共创总结还没确认');
    // 旧数据里的「用模板库里的＋自家背景」也一样
    expect(handoffBlocker(stateOf({ ...draft, backdropMode: 'library' }, [], { backdrop: refOfBackdrop(b) }), 'backdrop')).toBe('共创总结还没确认');
    expect(handoffBlocker(stateOf(draft, [], { backdrop: null }), 'backdrop')).toBe('选定的背景图找不到了');
    expect(handoffBlocker(stateOf({ ...draft, backdropId: null }, [], { backdrop: null }), 'backdrop')).toBe('还没选定背景图');
  });

  it('交接内容：商品写原图和三视图，信息写已确认、未知和还没处理的建议', () => {
    const { work, assets } = readyWork();
    expect(handoffText(stateOf(work, [...assets, upload(work.id, 'detail')]), 'product')).toBe(
      '【交接：商品】用户点了「下一步」，这是「商品」这一页现在的内容（系统代发，不是用户原话）：\n- 原图：正面已上传、侧面已上传、背面已上传；细节照 1 张；未分类 0 张\n- 三视图：正面已确认、侧面已确认、背面已确认',
    );
    const info = handoffText(stateOf(suggestInfo(markUnknown(work, 'size', true), 'material', '纯银'), assets), 'info');
    expect(info).toContain('- 品类：耳饰（已确认）');
    expect(info).toContain('- 尺寸：未知');
    expect(info).toContain('- 售价（选填）：未填');
    expect(info).toContain('- 还没处理的建议：材料「纯银」');
  });

  it('交接内容：背景写做法和选定的背景图；自己生成时再写共创总结、背景风格和是否沉淀', () => {
    const { work, assets } = readyWork();
    expect(handoffText(stateOf(work, assets), 'backdrop')).toContain('- 选定的背景图：「雨后清晨」（内置模板）；参数：示意模板，无参数');
    const w = backdropPromptedWork();
    const b = backdrop(w.id, 1, 0, { savedAt: 9, name: '苔绿晨光' });
    const text = handoffText(stateOf(chooseBackdrop(w, refOfBackdrop(b)), [], { backdrop: refOfBackdrop(b) }), 'backdrop');
    expect(text).toContain('- 做法：自己生成');
    expect(text).toContain('（这件作品生成的，已沉淀进模板库）');
    expect(text).toContain('- 共创总结（已确认）：表达「雨后青苔」');
    expect(text).toContain('- 背景风格：色调「雨后苔绿」、背景「手工纸」、光线「清冷晨光」、装饰道具「不放道具」');
  });

  it('交接内容：摆放写摆放三项、比例、提示词和批准', () => {
    const { work, assets } = promptedWork();
    expect(handoffText(stateOf(work, assets), 'placement')).toContain('- 合成批准：还没有');
    const a = approveScene(stateOf(work, assets));
    if (!a.ok) throw new Error('应当可以批准');
    const text = handoffText(stateOf(a.work, assets, { approval: a.approval }), 'placement');
    expect(text).toContain('- 摆放：平铺');
    expect(text).toContain('- 合成禁止项：没写');
    expect(text).toContain('- 合成提示词：有效');
    expect(text).toContain('- 合成批准：第 1 版有效，还没生成');
  });

  it('自上次交接以来的变化：改了的值、换了一张的照片和三视图、改过的提示词都列出来', () => {
    const { work, assets } = promptedWork();
    const before = factsOf(stateOf(work, assets));
    expect(diffFacts(before, factsOf(stateOf(work, assets)))).toEqual([]);
    const replaced = [{ ...assets[1], removed: true }, upload(work.id, 'side')];
    const after = stateOf(setStyle(setInfo(work, 'material', '纯银'), 'placement', '悬挂', 'user'), [...assets.filter((a) => a.id !== assets[1].id), ...replaced]);
    const texts = diffFacts(before, factsOf(after)).map(changeText);
    expect(texts).toContain('材料：黄铜镀金 → 纯银');
    expect(texts).toContain('摆放：平铺 → 悬挂');
    expect(texts).toContain('侧面照片换了一张（有）');
    expect(texts).toContain('侧面三视图：已确认 → 还没有');
    const edited = editPrompt(work, 'scene', '用户改过的', sceneBasisOf(work, assets));
    expect(diffFacts(before, factsOf(stateOf(edited, assets))).map(changeText)).toContain('合成提示词：有效 → 手改过，待核对');
    const redone = [...assets.slice(0, 5), view(assets[2])];
    expect(diffFacts(before, factsOf(stateOf(work, redone))).map(changeText)).toContain('背面三视图换了一张（已确认）');
  });

  it('排交接：同一步排两次只记一次', () => {
    const w = queueHandoff(queueHandoff(newWork({ imageModel: 'img-a', chatModel: 'chat-a', backdropId: BUILTIN }), 'backdrop'), 'backdrop');
    expect(w.pendingHandoffs).toEqual(['backdrop']);
  });
});
