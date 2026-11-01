import { describe, expect, it } from 'vitest';
import { styleConflicts } from './conflicts';

const style = (p: Partial<Record<string, string>>) => ({
  tone: '',
  background: '',
  light: '',
  placement: '',
  props: '',
  banned: '',
  composition: '',
  expression: '',
  ...p,
});

describe('styleConflicts（AC-05.3）', () => {
  it('道具和禁止出现写了同一样东西', () => {
    expect(styleConflicts(style({ props: '一朵干花、一本旧书', banned: '花，玻璃' }))).toEqual([
      '道具里有「花」，但「禁止出现」也写了「花」',
    ]);
  });

  it('悬挂和托盘矛盾', () => {
    expect(styleConflicts(style({ placement: '悬挂', props: '木托盘' }))).toEqual([
      '摆放选了「悬挂」，道具里却有托盘，二者可能矛盾',
    ]);
  });

  it('不放道具时不误报', () => {
    expect(styleConflicts(style({ props: '不放道具', banned: '道具' }))).toEqual([]);
    expect(styleConflicts(style({ placement: '平铺', props: '木托盘', banned: '' }))).toEqual([]);
  });
});
