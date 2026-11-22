import { describe, expect, it } from 'vitest';
import { upload, view, viewTask } from '@/test/fixtures';
import { activeUploads, angleState, anglesToGenerate, assetLabel, currentView, missingAngles, viewCheck, viewRefs, viewsDone, viewSources } from './assets';

const idle = { views: false, backdrop: false, scene: false };

describe('照片（PRD AC-02.1）', () => {
  it('在用的原图按正面、侧面、背面、细节、未分类排，跳过停用的', () => {
    const w = 'w';
    const list = [upload(w, 'unsorted'), upload(w, 'detail'), upload(w, 'back'), upload(w, 'front', { removed: true }), upload(w, 'side'), upload(w, 'front')];
    expect(activeUploads(list, w).map((a) => a.kind)).toEqual(['front', 'side', 'back', 'detail', 'unsorted']);
  });

  it('缺哪个角度就写明哪个', () => {
    expect(missingAngles([upload('w', 'side'), upload('w', 'detail')], 'w')).toEqual(['front', 'back']);
  });
});

describe('三视图（PRD AC-02.3、技术写法 13.3）', () => {
  const photos = () => (['front', 'side', 'back'] as const).map((k) => upload('w', k));

  it('某个角度现在的三视图：从这个角度现在的原图派生的最新一张', () => {
    const [front] = photos();
    const old = view(front, { createdAt: 1 });
    const redo = view(front, { createdAt: 2, confirmed: false });
    expect(currentView([front, old, redo], 'w', 'front')?.id).toBe(redo.id);
  });

  it('原图换掉、停用或改了类型：旧的三视图作废', () => {
    const [front, side, back] = photos();
    const views = [view(front), view(side), view(back)];
    expect(viewsDone([front, side, back, ...views], 'w')).toBe(true);
    const replaced = { ...front, removed: true, replacedBy: 'x' };
    const next = upload('w', 'front');
    expect(currentView([replaced, next, side, back, ...views], 'w', 'front')).toBeUndefined();
    const moved = { ...side, kind: 'detail' as const };
    expect(currentView([front, moved, back, ...views], 'w', 'side')).toBeUndefined();
    expect(viewsDone([front, moved, back, ...views], 'w')).toBe(false);
  });

  it('合成用的三视图：已确认的，按正面、侧面、背面', () => {
    const [front, side, back] = photos();
    const views = [view(back), view(front), view(side, { confirmed: false })];
    expect(viewRefs([front, side, back, ...views], 'w')).toEqual([views[1].id, views[0].id]);
  });

  it('角度状态：生成中、失败在现在这张之后、次数按原图算', () => {
    const [front] = photos();
    const v = view(front, { createdAt: 10 });
    const failed = viewTask('w', 'front', front.id, 'failed', { createdAt: 20, error: '内容被拦截' });
    expect(angleState([front, v], [failed], 'w', 'front')).toMatchObject({ view: v, failed: '内容被拦截', attempts: 1, generating: false });
    const earlier = { ...failed, createdAt: 5 };
    expect(angleState([front, v], [earlier], 'w', 'front').failed).toBeNull();
    const running = viewTask('w', 'front', front.id, 'running');
    expect(angleState([front], [running], 'w', 'front').generating).toBe(true);
    const otherPhoto = viewTask('w', 'front', 'asset_old', 'failed');
    expect(angleState([front], [otherPhoto], 'w', 'front').attempts).toBe(0);
  });

  it('参考图：这个角度的原图，再加正面原图；生成正面只带一次', () => {
    const [front, side, back] = photos();
    expect(viewSources([front, side, back], 'w', 'side')).toEqual([side.id, front.id]);
    expect(viewSources([front, side, back], 'w', 'front')).toEqual([front.id]);
    expect(viewSources([side, back], 'w', 'side')).toBeNull();
  });

  it('能不能生成：三张照片都要有；合成中、同一角度生成中、到次数上限时拒绝', () => {
    const [front, side, back] = photos();
    expect(viewCheck([front, side], [], 'w', ['front'], idle)).toEqual({ ok: false, reason: '还缺背面照片，三张都有才能生成三视图' });
    const all = [front, side, back];
    expect(viewCheck(all, [], 'w', ['front', 'side', 'back'], idle)).toEqual({ ok: true });
    expect(viewCheck(all, [], 'w', ['front'], { ...idle, scene: true })).toMatchObject({ ok: false, reason: '正在合成这一轮候选，等结束后再做三视图' });
    expect(viewCheck(all, [viewTask('w', 'side', side.id, 'running')], 'w', ['side'], idle)).toMatchObject({ ok: false, reason: '侧面的三视图正在生成' });
    const three = [1, 2, 3].map((n) => viewTask('w', 'back', back.id, 'failed', { createdAt: n }));
    expect(viewCheck(all, three, 'w', ['back'], idle)).toMatchObject({ ok: false, reason: '背面这张照片已经生成过 3 次三视图，换一张更清楚的照片再试' });
    expect(viewCheck(all, [], 'w', [], idle)).toMatchObject({ ok: false });
  });

  it('「生成三视图」一次做还没有三视图、也没在生成的角度', () => {
    const [front, side, back] = photos();
    const tasks = [viewTask('w', 'side', side.id, 'running')];
    expect(anglesToGenerate([front, side, back, view(front)], tasks, 'w')).toEqual(['back']);
  });

  it('叫法：原图按类型，三视图按角度', () => {
    const [front] = photos();
    expect(assetLabel(front)).toBe('正面照片');
    expect(assetLabel(view(front))).toBe('正面三视图');
    expect(assetLabel(upload('w', 'unsorted'))).toBe('未分类照片');
  });
});
