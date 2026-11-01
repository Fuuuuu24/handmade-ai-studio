import { describe, expect, it } from 'vitest';
import { readyWork } from '@/test/fixtures';
import { newScene, sameParams, sceneParamsOf, sceneSaveProblem, shopDiff, updateScene, updateShopStyle } from './library';
import type { ShopStyle } from './types';
import { applyShopPrefs, setStyle } from './work';

const emptyShop = (): ShopStyle => ({ id: 'me', prefs: {}, history: [] });

describe('摄影布景（FR-06）', () => {
  it('从作品取布景参数：不含「表达」这类单件内容（AC-06.3）', () => {
    const { work } = readyWork();
    const w = setStyle(work, 'expression', '雨后的安静', 'user');
    const p = sceneParamsOf(w);
    expect(p).not.toHaveProperty('expression');
    expect(p.light).toBe('清冷晨光');
  });

  it('没名字或风格没选齐不能存', () => {
    const { work } = readyWork();
    expect(sceneSaveProblem(sceneParamsOf(work), '  ')).toBe('布景要起个名字');
    const w = setStyle(work, 'light', '', 'user');
    expect(sceneSaveProblem(sceneParamsOf(w), '青苔')).toContain('光线');
    expect(sceneSaveProblem(sceneParamsOf(work), '青苔')).toBeNull();
  });

  it('更新布景生成新版本，旧版本进历史（AC-06.5）', () => {
    const { work } = readyWork();
    const v1 = newScene(' 青苔 ', sceneParamsOf(work), 1000);
    expect(v1).toMatchObject({ name: '青苔', version: 1, history: [] });
    const params = sceneParamsOf(setStyle(work, 'light', '窗边侧光', 'user'));
    const v2 = updateScene(v1, params, '', 2000);
    expect(v2).toMatchObject({ id: v1.id, name: '青苔', version: 2, updatedAt: 2000 });
    expect(v2.history).toEqual([{ version: 1, name: '青苔', params: v1.params, at: 1000 }]);
    expect(sameParams(v2.params, v1.params)).toBe(false);
  });
});

describe('我的风格（AC-06.4）', () => {
  it('只写变化的项，并记下修改前后和理由', () => {
    const s1 = updateShopStyle(emptyShop(), { light: '清冷晨光', tone: '雨后苔绿' }, '第一件作品满意', 1000);
    expect(s1.prefs).toEqual({ light: '清冷晨光', tone: '雨后苔绿' });
    expect(s1.history).toEqual([{ at: 1000, before: { light: '', tone: '' }, after: { light: '清冷晨光', tone: '雨后苔绿' }, reason: '第一件作品满意' }]);
    expect(shopDiff(s1, { light: '清冷晨光', background: '石材' })).toEqual({ background: '石材' });
    const s2 = updateShopStyle(s1, { light: '清冷晨光' }, '没变化');
    expect(s2).toBe(s1); // 没有变化不留记录
  });

  it('空值表示从长期风格里去掉', () => {
    const s1 = updateShopStyle(emptyShop(), { props: '一小片苔藓' }, '');
    const s2 = updateShopStyle(s1, { props: '' }, '不要道具了');
    expect(s2.prefs).toEqual({});
    expect(s2.history.at(-1)).toMatchObject({ before: { props: '一小片苔藓' }, after: { props: '' } });
  });

  it('套用到作品：来源标「我的风格」，空的项不覆盖', () => {
    const { work } = readyWork();
    const w = applyShopPrefs(work, { light: '窗边侧光', tone: ' ' });
    expect(w.style.light).toEqual({ value: '窗边侧光', source: 'shop' });
    expect(w.style.tone).toEqual(work.style.tone);
  });
});
