import { getBlob, logEvent, patchResult } from '@/data/repo';
import { passed } from '@/domain/generation';
import type { Result } from '@/domain/types';

// 导出一张候选（AC-10.1）：两项都满意才能导出；图片读不出来时如实说明，不显示成功
export async function exportResult(workName: string, result: Result): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!passed(result)) return { ok: false, reason: '两项都验收满意后才能导出' };
  let blob: Blob | undefined;
  try {
    blob = await getBlob(result.blobId);
  } catch (e) {
    return { ok: false, reason: `图片读不出来：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!blob) return { ok: false, reason: '本地找不到这张图片（可能清理过浏览器数据）' };
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${workName}-第${result.round}轮-候选${result.slot + 1}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  await patchResult(result.id, (r) => {
    r.exports = [...r.exports, Date.now()];
  });
  void logEvent('export', result.workId, { round: result.round, slot: result.slot });
  return { ok: true };
}
