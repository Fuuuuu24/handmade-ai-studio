import { addUpload, logEvent } from '@/data/repo';
import { activeUploads } from '@/domain/snapshot';
import type { AssetKind } from '@/domain/types';
import { assetsChanged } from '@/domain/work';
import { errorText } from './api';
import { checkFile, prepareUpload } from './images';
import { loadContext, mutateWork } from './work-store';

// 添加作品照片：逐张校验，第一张默认是整体图、之后默认细节图（可在画布里改）；有新照片时资产需要重新确认
export async function addPhotos(workId: string, files: File[], kind?: AssetKind): Promise<{ assetIds: string[]; notes: string[] }> {
  const ctx = await loadContext(workId);
  const uploads = activeUploads(ctx.assets, workId);
  let count = uploads.length;
  let hasOverall = uploads.some((a) => a.kind === 'overall');
  const assetIds: string[] = [];
  const notes: string[] = [];
  for (const file of files) {
    const problem = checkFile(file, count);
    if (problem) {
      notes.push(problem);
      continue;
    }
    try {
      const prepared = await prepareUpload(file);
      const asset = await addUpload(workId, kind ?? (hasOverall ? 'detail' : 'overall'), prepared);
      assetIds.push(asset.id);
      count += 1;
      hasOverall = true;
      notes.push(...prepared.warnings.map((w) => `「${file.name}」${w}`));
    } catch (e) {
      notes.push(`「${file.name}」没有加上：${errorText(e)}`);
    }
  }
  if (assetIds.length) {
    await mutateWork(workId, (c) => assetsChanged(c.work));
    void logEvent('upload', workId, { count: assetIds.length });
  }
  return { assetIds, notes };
}
