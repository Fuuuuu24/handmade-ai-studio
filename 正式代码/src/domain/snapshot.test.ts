import { describe, expect, it } from 'vitest';
import { MAX_REFS, readyWork, upload, white } from '@/test/fixtures';
import { basisOf, diffBasis, diffSnapshot, referencesOf, snapshotOf } from './snapshot';
import { draftSummary, setInfo, setRatio, setRoute, setStyle, suggestInfo, chooseWhite, applyScene } from './work';
import { builtinScene } from '@/config/scenes';

describe('referencesOf', () => {
  it('B 路线按整体、背面、细节排序，跳过已移除的原图，并按模型上限截断', () => {
    const { work } = readyWork();
    const detail = upload(work.id, 'detail', { createdAt: 1 });
    const overall = upload(work.id, 'overall', { createdAt: 3 });
    const back = upload(work.id, 'back', { createdAt: 2 });
    const gone = upload(work.id, 'overall', { createdAt: 0, removed: true });
    const other = upload('another-work', 'overall');
    const assets = [detail, overall, back, gone, other];
    expect(referencesOf(work, assets, 9)).toEqual([overall.id, back.id, detail.id]);
    expect(referencesOf(work, assets, 2)).toEqual([overall.id, back.id]);
  });

  it('A 路线只用选定的白底图加细节图', () => {
    const { work: w0 } = readyWork();
    const overall = upload(w0.id, 'overall');
    const detail = upload(w0.id, 'detail');
    const wb = white(w0.id, overall.id);
    const work = chooseWhite(setRoute(w0, 'A'), wb.id);
    expect(referencesOf(work, [overall, detail, wb], MAX_REFS)).toEqual([wb.id, detail.id]);
  });
});

describe('basisOf', () => {
  it('只取已确认的信息和总结：建议、选填字段、草稿总结都不进依据', () => {
    const { work: w0, assets } = readyWork();
    const base = basisOf(w0, assets, MAX_REFS);
    let w = suggestInfo(w0, 'material', '纯银');
    w = setInfo(w, 'price', '128 元');
    expect(basisOf(w, assets, MAX_REFS)).toEqual(base);
    expect(base.info.material).toEqual({ value: '黄铜镀金', unknown: false });

    const drafted = draftSummary(w0, { express: '新的故事', feel: '', avoid: '' });
    expect(basisOf(drafted, assets, MAX_REFS).summary).toBeNull();
  });
});

describe('diffBasis / diffSnapshot', () => {
  it('列出具体改了什么', () => {
    const { work, assets } = readyWork();
    const a = basisOf(work, assets, MAX_REFS);
    const b = basisOf(setStyle(setRatio(work, '3:4'), 'light', '窗边侧光', 'user'), assets, MAX_REFS);
    expect(diffBasis(a, b)).toEqual(['比例', '光线']);
  });

  it('只换布景、风格值不变时报「布景」', () => {
    const { work, assets } = readyWork();
    const scene = builtinScene('tpl-moss')!;
    const a = basisOf(work, assets, MAX_REFS);
    const b = basisOf(applyScene(work, 'my-copy', scene.params), assets, MAX_REFS);
    expect(diffBasis(a, b)).toEqual(['布景']);
  });

  it('其他内容没变、只有提示词变时才报「提示词」', () => {
    const { work, assets } = readyWork();
    const s1 = { ...snapshotOf(work, assets, MAX_REFS), prompt: 'A' };
    const s2 = { ...s1, prompt: 'B' };
    expect(diffSnapshot(s1, s2)).toEqual(['提示词']);
    expect(diffSnapshot(s1, { ...s2, ratio: '9:16' })).toEqual(['比例']);
  });
});
