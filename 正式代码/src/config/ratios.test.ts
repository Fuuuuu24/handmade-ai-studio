import { describe, expect, it } from 'vitest';
import { BACKDROP } from './backdrops';
import { ratioHeight } from './ratios';

describe('按比例算高（评审第 14 条）', () => {
  it('示意背景图的高度跟着背景比例走', () => {
    expect(ratioHeight('3:4', 768)).toBe(1024);
    expect(ratioHeight('3:4', 384)).toBe(512);
    expect(ratioHeight('9:16', 900)).toBe(1600);
    expect(ratioHeight('1:1', 500)).toBe(500);
    expect(ratioHeight(BACKDROP.ratio, BACKDROP.placeholderWidth.full)).toBe(1024);
  });
});
