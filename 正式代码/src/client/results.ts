import { logEvent, patchResult } from '@/data/repo';
import { verdictKey } from '@/domain/notices';
import type { Result, Verdict } from '@/domain/types';

export type VerdictPatch = Partial<Record<'real' | 'style', Verdict>>;

/* 两项验收（PRD AC-09.1）：画布上的「像／不像」「对／不对」和小间问过用户后代点的都走这里。
   按数据库里的最新记录只改这几项（连着点也不会互相覆盖），记下改的时间：用户停手一会儿再告诉小间（技术写法 13.12）。
   小间代点的不再发验收通知：它自己点的，知道结果（技术写法 14.4）。 */
export async function setVerdict(result: Result, patch: VerdictPatch, by?: 'agent'): Promise<void> {
  const set = (['real', 'style'] as const).flatMap((k) => (patch[k] ? [[k, patch[k]] as const] : []));
  if (!set.length) return;
  await patchResult(result.id, (r) => {
    r.verdict = { ...r.verdict, ...Object.fromEntries(set) };
    r.verdictAt = Date.now();
    if (by) r.notifiedVerdict = verdictKey(r);
  });
  for (const [kind, value] of set) void logEvent('verdict', result.workId, { round: result.round, slot: result.slot, kind, value, ...(by ? { by } : {}) });
}
