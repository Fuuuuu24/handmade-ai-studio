import { db } from '@/data/db';
import { failedEventCount, listEvents, listScenes } from '@/data/repo';
import { deletedRow, toCsv, trialRow } from '@/domain/trial';

// 试用者匿名编号：每个浏览器生成一次，存在本地（AC-10.4）
export function trialId(): string {
  const key = 'yijian:trial-id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = `T-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'T-本机';
  }
}

// 导出试用记录（PRD 6.2）：每件作品一行，CSV 下载；漏记的事件数如实返回
export async function exportTrialRecord(): Promise<{ works: number; missedEvents: number }> {
  const d = db();
  const [works, assets, tasks, results, approvals, events, scenes] = await Promise.all([
    d.works.toArray(),
    d.assets.toArray(),
    d.tasks.toArray(),
    d.results.toArray(),
    d.approvals.toArray(),
    listEvents(),
    listScenes(),
  ]);
  const anon = trialId();
  const saved = new Set(scenes.map((s) => s.id));
  const sorted = [...works].sort((a, b) => a.createdAt - b.createdAt);
  const rows = sorted.map((work, i) =>
    trialRow(
      anon,
      i + 1,
      { work, assets: assets.filter((a) => a.workId === work.id), tasks: tasks.filter((t) => t.workId === work.id), results: results.filter((r) => r.workId === work.id) },
      approvals,
      events,
      saved,
    ),
  );
  const del = deletedRow(anon, events);
  if (del) rows.push(del);
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `一间试用记录-${anon}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { works: sorted.length, missedEvents: failedEventCount() };
}
