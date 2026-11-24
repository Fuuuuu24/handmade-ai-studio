import { describe, expect, it } from 'vitest';
import { backdropConflicts, sceneConflicts } from './conflicts';

const bd = (p: Partial<Record<string, string>>) => ({ tone: '', background: '', light: '', props: '', bannedBackdrop: '', ...p });
const sc = (p: Partial<Record<string, string>>) => ({ placement: '', composition: '', bannedScene: '', ...p });

describe('风格冲突（AC-05.3），背景和摆放分开查', () => {
  it('装饰道具和背景禁止项写了同一样东西', () => {
    expect(backdropConflicts(bd({ props: '一小片苔藓、旧书', bannedBackdrop: '花，苔藓' }))).toEqual([
      '道具里有「苔藓」，但背景的「禁止出现」也写了「苔藓」',
    ]);
  });

  it('不放道具时不误报', () => {
    expect(backdropConflicts(bd({ props: '不放道具', bannedBackdrop: '道具' }))).toEqual([]);
  });

  it('摆放（展示用具）和合成禁止项写了同一样东西；悬挂又要托盘', () => {
    expect(sceneConflicts(sc({ placement: '放进首饰托盘', bannedScene: '托盘' }))).toEqual(['摆放里有「托盘」，但合成的「禁止出现」也写了「托盘」']);
    expect(sceneConflicts(sc({ placement: '悬挂，下面垫一个托盘' }))).toEqual(['摆放写了「悬挂」，又要放进托盘，二者可能矛盾']);
  });

  it('装饰道具和展示用具不算冲突：背景里没有托盘，合成时按摆放加上（2026-11-22 发起人确认）', () => {
    expect(backdropConflicts(bd({ props: '不放道具' }))).toEqual([]);
    expect(sceneConflicts(sc({ placement: '首饰托盘' }))).toEqual([]);
  });
});
