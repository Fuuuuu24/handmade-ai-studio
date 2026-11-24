import { describe, expect, it } from 'vitest';
import { refOfBackdrop } from '@/domain/backdrops';
import { chooseBackdrop } from '@/domain/work';
import { backdrop, backdropWork, product, stateOf, upload } from '@/test/fixtures';
import { chatPhotos, type ChatPhoto } from './chat-body';
import { deriveContext } from './work-store';

const photo = (id: string, label: string): ChatPhoto => ({ id, label, blob: async () => undefined });

describe('给小间看的图（技术写法 13.9）', () => {
  it('三视图通知把刚生成的三张排在最前，不再重复加，背景图和细节照还在（评审第 3 条）', () => {
    const b = backdrop('work_other', 1, 0, { savedAt: 1, name: '苔绿晨光' });
    const w = chooseBackdrop(backdropWork(), refOfBackdrop(b));
    const assets = [...product(w.id), upload(w.id, 'detail')];
    const views = assets.filter((a) => a.origin === 'view');
    const ctx = deriveContext(stateOf(w, assets, { backdrop: refOfBackdrop(b) }));
    const first = views.map((v) => photo(v.id, `刚生成的${v.view}三视图`));
    const list = chatPhotos(ctx, first);
    expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    expect(list.slice(0, 3).map((p) => p.label)).toEqual(first.map((p) => p.label));
    expect(list.map((p) => p.label)).toEqual([...first.map((p) => p.label), '选定的背景图「苔绿晨光」', '细节照片']);
    // 同一张排在最前面两次（生成通知和验收通知都带了它）也只附一次
    expect(chatPhotos(ctx, [first[0], first[0]]).filter((p) => p.id === first[0].id)).toHaveLength(1);
  });
});
