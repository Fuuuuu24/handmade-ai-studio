import { describe, expect, it } from 'vitest';
import { backdropPromptedWork, BUILTIN, product, readyWork, upload, view } from '@/test/fixtures';
import { backdropBasisOf, backdropSnapshotOf, diffBackdropBasis, diffSceneBasis, diffSceneSnapshot, sceneBasisOf, sceneSnapshotOf } from './snapshot';
import { draftSummary, setInfo, setStyle, suggestInfo, chooseLibraryBackdrop } from './work';

describe('合成依据（技术写法 13.5）', () => {
  it('参考图是三张已确认的三视图；原图和细节照不进（AC-02.3a）', () => {
    const { work, assets } = readyWork();
    const withDetail = [...assets, upload(work.id, 'detail')];
    expect(sceneBasisOf(work, withDetail).references).toEqual(assets.slice(3).map((a) => a.id));
  });

  it('只取已确认的信息和总结：建议、选填字段、草稿总结都不进依据；背景五项不进合成依据', () => {
    const { work, assets } = readyWork();
    const w = draftSummary(setInfo(suggestInfo(work, 'material', '纯银'), 'price', '99 元'), { express: '草稿', feel: '', avoid: '' });
    const b = sceneBasisOf(setStyle(w, 'light', '暖调午后光', 'user'), assets);
    expect(b.info.material).toEqual({ value: '黄铜镀金', unknown: false });
    expect(b.summary).toBeNull();
    expect(b).not.toHaveProperty('info.price');
    expect(b.style).toEqual({ placement: '平铺', composition: '主体居中，留白多', bannedScene: '' });
    expect(b.backdropId).toBe(BUILTIN);
  });

  it('改了什么：背景图、三视图、比例、摆放分别报', () => {
    const { work, assets } = readyWork();
    const a = sceneBasisOf(work, assets);
    expect(diffSceneBasis(a, sceneBasisOf(chooseLibraryBackdrop(work, 'builtin:rose@1'), assets))).toEqual(['背景图']);
    const redo = [...assets.slice(0, 5), view(assets[2])];
    expect(diffSceneBasis(a, sceneBasisOf(work, redo))).toEqual(['三视图']);
    expect(diffSceneBasis(a, sceneBasisOf(setStyle({ ...work, ratio: '3:4' }, 'composition', '主体放大，突出细节', 'user'), assets))).toEqual(['比例', '构图']);
  });

  it('其他内容没变、只有提示词变时才报「提示词」', () => {
    const { work, assets } = readyWork();
    const a = sceneSnapshotOf(work, assets);
    expect(diffSceneSnapshot(a, { ...a, prompt: '新的' })).toEqual(['提示词']);
    expect(diffSceneSnapshot(a, { ...a, prompt: '新的', ratio: '9:16' })).toEqual(['比例']);
  });
});

describe('背景依据（技术写法 13.4）', () => {
  it('背景五项、确认过的总结、品类和尺寸、生图模型；材料和摆放不进', () => {
    const w = backdropPromptedWork();
    const b = backdropBasisOf(setStyle(setInfo(w, 'material', '纯银'), 'placement', '悬挂', 'user'));
    expect(b).toEqual({
      style: { tone: '雨后苔绿', background: '手工纸', light: '清冷晨光', props: '', bannedBackdrop: '' },
      summary: { express: '雨后青苔', feel: '安静', avoid: '太花' },
      info: { category: { value: '耳饰', unknown: false }, size: { value: '长 4.5cm', unknown: false } },
      imageModel: 'img-a',
    });
    expect(backdropSnapshotOf(w)).toMatchObject({ prompt: w.backdropPrompt!.text, count: 2 });
  });

  it('改了什么：尺寸报「品类和尺寸」，道具报「装饰道具」', () => {
    const w = backdropPromptedWork();
    const a = backdropBasisOf(w);
    expect(diffBackdropBasis(a, backdropBasisOf(setStyle(setInfo(w, 'size', '5cm'), 'props', '旧书', 'user')))).toEqual(['品类和尺寸', '装饰道具']);
  });

  it('product 自检：三张三视图都派生自同角度原图', () => {
    const assets = product('w');
    expect(assets.slice(3).map((v) => assets.find((p) => p.id === v.parentId)?.kind)).toEqual(['front', 'side', 'back']);
  });
});
