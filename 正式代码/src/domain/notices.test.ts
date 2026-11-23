import { describe, expect, it } from 'vitest';
import { backdrop, result, task, viewTask } from '@/test/fixtures';
import { noticeText, pendingNotices, pendingVerdicts, verdictKey, verdictText } from './notices';
import type { Task } from './types';
import { newWork } from './work';
import { stateOf } from '@/test/fixtures';

const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
const done = (t: Task, extra: Partial<Task> = {}): Task => ({ ...t, notifiedAt: null, ...extra });

describe('生成通知（PRD AC-11.3c，技术写法 13.12）', () => {
  it('三视图一批都结束才发；已经通知过的不再发', () => {
    const a = done(viewTask(w.id, 'front', 'p1', 'succeeded'));
    const b = viewTask(w.id, 'side', 'p2', 'running');
    expect(pendingNotices(stateOf(w, [], { tasks: [a, b] }))).toEqual([]);
    const c = done(viewTask(w.id, 'side', 'p2', 'failed'), { error: '内容被拦截' });
    const batches = pendingNotices(stateOf(w, [], { tasks: [a, c, { ...done(viewTask(w.id, 'back', 'p3', 'succeeded')), notifiedAt: 5 }] }));
    expect(batches).toEqual([{ kind: 'view', tasks: [a, c] }]);
    expect(noticeText(stateOf(w), batches[0])).toBe('【通知：三视图】正面生成好了，待用户对照原图确认；侧面没生成出来（内容被拦截）。三视图要用户对照原图看：他觉得可以用，问他要不要替他点「可以用」（ask_confirm）；不像的可以单独重做。');
  });

  it('背景、候选按轮次：那一轮两张都有结果（含部分失败）才发；文字按整轮现在的样子写', () => {
    const t0 = done(task(w.id, 1, 0, 'succeeded', 1, 'backdrop'));
    const t1 = task(w.id, 1, 1, 'running', 1, 'backdrop');
    expect(pendingNotices(stateOf(w, [], { tasks: [t0, t1] }))).toEqual([]);
    const f1 = done({ ...t1, status: 'failed', error: '超时' });
    const b0 = backdrop(w.id, 1, 0);
    const [batch] = pendingNotices(stateOf(w, [], { tasks: [t0, f1] }));
    expect(batch).toMatchObject({ kind: 'backdrop', round: 1 });
    expect(noticeText(stateOf(w, [], { tasks: [t0, f1], backdrops: [b0] }), batch)).toBe(
      `【通知：背景图】第 1 轮：背景 1 生成好了（${b0.id}）；背景 2 没生成出来（超时），可以补齐。选哪张要用户看过图决定，图里不能有饰品，请他把关：他在画布上点「用这张」，或你问过、他同意后代点。`,
    );
    const s0 = done(task(w.id, 2, 0, 'succeeded'));
    const s1 = done(task(w.id, 2, 1, 'succeeded'));
    const r = [result(w.id, 2, 0), result(w.id, 2, 1)];
    const [scene] = pendingNotices(stateOf(w, [], { tasks: [s0, s1], results: r }));
    expect(noticeText(stateOf(w, [], { tasks: [s0, s1], results: r }), scene)).toBe('【通知：候选】第 2 轮：候选 1 生成好了；候选 2 生成好了。两项验收要用户看过图判断：他在画布上点，或你问过、他同意后代点。');
  });

  it('补齐后又失败：通知写最后一次的原因，不看任务在数组里的顺序（评审第 11 条）', () => {
    const second = done({ ...task(w.id, 1, 0, 'failed', 2, 'scene'), error: '第二次：内容被拦截' });
    const first = { ...task(w.id, 1, 0, 'failed', 1, 'scene'), notifiedAt: 5, error: '第一次：超时' };
    const ok = { ...task(w.id, 1, 1, 'succeeded'), notifiedAt: 5 };
    const r = [result(w.id, 1, 1)];
    for (const tasks of [[second, first, ok], [first, second, ok]]) {
      const [b] = pendingNotices(stateOf(w, [], { tasks, results: r }));
      expect(noticeText(stateOf(w, [], { tasks, results: r }), b)).toContain('候选 1 没生成出来（第二次：内容被拦截），可以补齐');
    }
    const bd2 = done({ ...task(w.id, 1, 0, 'failed', 2, 'backdrop'), error: '第二次：内容被拦截' });
    const bd1 = { ...task(w.id, 1, 0, 'failed', 1, 'backdrop'), notifiedAt: 5, error: '第一次：超时' };
    const bdOk = { ...task(w.id, 1, 1, 'succeeded', 1, 'backdrop'), notifiedAt: 5 };
    const [bb] = pendingNotices(stateOf(w, [], { tasks: [bd2, bd1, bdOk] }));
    expect(noticeText(stateOf(w, [], { tasks: [bd2, bd1, bdOk] }), bb)).toContain('背景 1 没生成出来（第二次：内容被拦截）');
  });

  it('补齐的那张结束后，只通知它，但说整轮的情况', () => {
    const first = { ...task(w.id, 1, 0, 'failed', 1, 'scene'), notifiedAt: 5, error: '超时' };
    const ok = { ...task(w.id, 1, 1, 'succeeded'), notifiedAt: 5 };
    const retry = done(task(w.id, 1, 0, 'succeeded', 2));
    const [b] = pendingNotices(stateOf(w, [], { tasks: [first, ok, retry] }));
    expect(b.tasks).toEqual([retry]);
  });
});

describe('验收通知', () => {
  it('两项都点了、停手满 6 秒才发；内容（含问题标签和说明）变了才再发', () => {
    const r = { ...result(w.id, 1, 0, { real: 'bad', style: 'ok' }), issues: ['轮廓'], note: '链子变长了', verdictAt: 1000 };
    expect(pendingVerdicts(stateOf(w, [], { results: [r] }), 4000, 6000)).toEqual({ ready: [], waitMs: 3000 });
    expect(pendingVerdicts(stateOf(w, [], { results: [r] }), 7000, 6000)).toEqual({ ready: [r], waitMs: null });
    const sent = { ...r, notifiedVerdict: verdictKey(r) };
    expect(pendingVerdicts(stateOf(w, [], { results: [sent] }), 9000, 6000).ready).toEqual([]);
    expect(pendingVerdicts(stateOf(w, [], { results: [{ ...sent, issues: ['轮廓', '颜色'] }] }), 9000, 6000).ready).toHaveLength(1);
    const half = { ...result(w.id, 1, 1, { real: 'ok', style: 'none' }), verdictAt: 0 };
    expect(pendingVerdicts(stateOf(w, [], { results: [half] }), 9000, 6000).ready).toEqual([]);
    expect(verdictText(r)).toBe('【通知：验收】第 1 轮候选 1：像不像实物：不像；风格对不对：对；问题：轮廓；用户说：链子变长了。这是用户的判断，不要自己改；要改先问他。');
    expect(verdictText({ ...r, verdict: { real: 'ok', style: 'ok' }, issues: [], note: '' })).toContain('两项都满意，可以放下载卡片');
  });
});
