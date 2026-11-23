import { describe, expect, it } from 'vitest';
import { backdrop, backdropPromptedWork, BUILTIN, stateOf } from '@/test/fixtures';
import { agentPickProblem, backdropCandidates, backdropDone, backdropLag, backdropModeOf, refOfBackdrop, refOfBuiltin, usedBy, userPickProblem } from './backdrops';
import type { SceneApproval } from './types';
import { approveBackdrop, chooseBackdrop, confirmSummary, draftSummary, editSummary, newWork, setImageModel, startBackdropRound } from './work';

const work = () => newWork({ imageModel: 'img-a', chatModel: 'chat-a' });

describe('背景图与模板库（PRD FR-06）', () => {
  it('内置模板参数为空、图还没提供时标示意；数据库里的背景图带参数和来源', () => {
    expect(refOfBuiltin(BUILTIN)).toMatchObject({ builtin: true, placeholder: true, params: null, saved: true, deleted: false, workId: null });
    expect(refOfBuiltin('builtin:nope@1')).toBeNull();
    const b = backdrop('w1', 1, 0, { savedAt: 5 });
    expect(refOfBackdrop(b)).toMatchObject({ builtin: false, saved: true, deleted: false, workId: 'w1', params: b.params });
  });

  it('这一轮的候选按张排，只看这件作品', () => {
    const list = [backdrop('w', 2, 1), backdrop('w', 1, 0), backdrop('w', 2, 0), backdrop('x', 2, 0)];
    expect(backdropCandidates(list, 'w', 2).map((b) => [b.round, b.slot])).toEqual([
      [2, 0],
      [2, 1],
    ]);
  });

  it('背景这一步完成：选定了背景图；选的是自己生成的还要共创总结已确认', () => {
    const w = work();
    expect(backdropDone(w, null)).toBe(false);
    expect(backdropDone(w, refOfBuiltin(BUILTIN))).toBe(true);
    const own = refOfBackdrop(backdrop(w.id, 1, 0));
    expect(backdropDone(w, own)).toBe(false);
    expect(backdropDone(confirmSummary(draftSummary(w, { express: '雨后', feel: '', avoid: '' })), own)).toBe(true);
    expect(backdropDone(w, refOfBackdrop(backdrop('other', 1, 0, { savedAt: 1 })))).toBe(true);
  });

  it('小间只能选内置或已沉淀、没删除的；候选只能用户点（技术写法 13.7）', () => {
    expect(agentPickProblem(refOfBuiltin(BUILTIN), BUILTIN)).toBeNull();
    expect(agentPickProblem(null, 'bd_x')).toBe('没有编号为 bd_x 的背景图');
    expect(agentPickProblem(refOfBackdrop(backdrop('w', 1, 0)), 'x')).toContain('选哪张要由用户在画布上点「用这张」');
    expect(agentPickProblem(refOfBackdrop(backdrop('w', 1, 0, { savedAt: 1, deletedAt: 2 })), 'x')).toBe('这张背景图已经从模板库删除，不能再选');
  });

  it('用户能选模板库里的和这件作品的候选；删掉的不能再被新选，但正在用的照常（AC-06.4）', () => {
    const w = work();
    expect(userPickProblem(refOfBackdrop(backdrop(w.id, 1, 0)), w)).toBeNull();
    expect(userPickProblem(refOfBackdrop(backdrop('other', 1, 0)), w)).toBe('这张背景图还没沉淀进模板库');
    const gone = backdrop('other', 1, 0, { savedAt: 1, deletedAt: 2 });
    expect(userPickProblem(refOfBackdrop(gone), w)).toBe('这张背景图已经从模板库删除，不能再选');
    expect(userPickProblem(refOfBackdrop(gone), { ...w, backdropId: gone.id })).toBeNull();
    // 这件作品自己的：沉淀后又删除也能重选（评审第 10 条）
    expect(userPickProblem(refOfBackdrop(backdrop(w.id, 1, 1, { savedAt: 1, deletedAt: 2 })), w)).toBeNull();
  });

  it('背景做法跟着来源走：自家的是自己生成，内置和别的作品沉淀的是用模板库里的', () => {
    const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
    expect(backdropModeOf(w, refOfBackdrop(backdrop(w.id, 1, 0)))).toBe('generate');
    expect(backdropModeOf(w, refOfBackdrop(backdrop(w.id, 1, 0, { savedAt: 1, deletedAt: 2 })))).toBe('generate');
    expect(backdropModeOf(w, refOfBackdrop(backdrop('other', 1, 0, { savedAt: 1 })))).toBe('library');
    expect(backdropModeOf(w, refOfBuiltin(BUILTIN)!)).toBe('library');
  });

  it('被几件作品用过：现在选着的，加上合成批准里用过的', () => {
    const a = { ...work(), backdropId: BUILTIN };
    const b = work();
    const used = { kind: 'scene', workId: b.id, snapshot: { backdropId: BUILTIN } } as unknown as SceneApproval;
    expect(usedBy(BUILTIN, [a, b], [used])).toBe(2);
    expect(usedBy('builtin:rose@1', [a, b], [used])).toBe(0);
  });
});

describe('选定的背景是不是按旧的内容生成的（技术写法 13.4）', () => {
  // 批准并生成第 1 轮背景，选定其中一张
  function picked() {
    const a = approveBackdrop(stateOf(backdropPromptedWork()));
    if (!a.ok) throw new Error('应当可以批准背景');
    const s = startBackdropRound(stateOf(a.work, [], { backdropApproval: a.approval }), a.approval);
    if (!s.ok) throw new Error('应当可以生成背景');
    const b = backdrop(s.work.id, 1, 0);
    return { work: chooseBackdrop(s.work, refOfBackdrop(b)), approval: s.approval, b };
  }
  const lag = (w: ReturnType<typeof picked>['work'], x: ReturnType<typeof picked>) =>
    backdropLag(stateOf(w, [], { backdrops: [x.b], backdrop: refOfBackdrop(x.b), backdropApproval: x.approval }));

  it('生成后没改过：不提示；之后改了共创总结：提示改了什么；只换生图模型不算（AC-06.7）', () => {
    const x = picked();
    expect(lag(x.work, x)).toEqual([]);
    const s = x.work.story.summary!;
    expect(lag(editSummary(x.work, { ...s, feel: '更温暖' }), x)).toEqual(['共创总结']);
    expect(lag(setImageModel(x.work, 'img-b'), x)).toEqual([]);
  });

  it('选的是模板库里的背景，或这一轮的批准对不上：不提示', () => {
    const x = picked();
    expect(backdropLag(stateOf(x.work, [], { backdrop: refOfBuiltin(BUILTIN), backdropApproval: x.approval }))).toEqual([]);
    expect(backdropLag(stateOf(x.work, [], { backdrops: [{ ...x.b, round: 2 }], backdrop: refOfBackdrop(x.b), backdropApproval: x.approval }))).toEqual([]);
  });
});
