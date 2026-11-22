import { describe, expect, it } from 'vitest';
import { backdropWork, currentBasis, readyWork } from '@/test/fixtures';
import { saidQuoteFound } from './said';
import { backdropBasisOf } from './snapshot';
import { editPrompt, writePrompt } from './work';

describe('saidQuoteFound（BC-013）', () => {
  it('片段能在用户消息里逐字找到才算；空格和标点不影响', () => {
    const texts = ['想要安静一点的标本小屋，耳环平铺 在石台上。'];
    expect(saidQuoteFound('平铺', texts)).toBe(true);
    expect(saidQuoteFound('「平铺在石台上」', texts)).toBe(true);
    expect(saidQuoteFound('冷灰', texts)).toBe(false);
  });

  it('没附原话、或片段太短时不算', () => {
    const texts = ['灰泥墙'];
    expect(saidQuoteFound(undefined, texts)).toBe(false);
    expect(saidQuoteFound('灰', texts)).toBe(false);
    expect(saidQuoteFound('  ，', texts)).toBe(false);
  });

  it('用户手改合成提示词时新写的字算；小间原来就写过的不算', () => {
    const { work, assets } = readyWork();
    const basis = currentBasis(work, assets);
    const drafted = writePrompt(work, 'scene', '一对耳饰立在石台上，偏冷灰色调。', basis);
    expect(saidQuoteFound('平铺', [], [drafted.prompt])).toBe(false);
    const edited = editPrompt(drafted, 'scene', '一对耳饰平铺在石台上，偏冷灰色调。', basis);
    expect(saidQuoteFound('平铺', [], [edited.prompt])).toBe(true);
    expect(saidQuoteFound('冷灰', [], [edited.prompt])).toBe(false);
  });

  it('背景提示词里用户新写的字也算（技术写法 13.12）', () => {
    const w = backdropWork();
    const drafted = writePrompt(w, 'backdrop', '米白亚麻布背景，柔和晨光。', backdropBasisOf(w));
    const edited = editPrompt(drafted, 'backdrop', '米白灰泥墙背景，柔和晨光。', backdropBasisOf(w));
    expect(saidQuoteFound('灰泥墙', [], [edited.prompt, edited.backdropPrompt])).toBe(true);
    expect(saidQuoteFound('灰泥墙', [], [edited.prompt])).toBe(false);
  });
});
