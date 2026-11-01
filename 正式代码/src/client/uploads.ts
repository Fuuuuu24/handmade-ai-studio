import { addUpload, logEvent, replaceAsset } from '@/data/repo';
import { activeUploads } from '@/domain/snapshot';
import type { Asset, AssetKind } from '@/domain/types';
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

// 替换原图（PRD 4.2 第 5 条）：用户确认后调用；新增一条记录，旧的标记为被替换、原图保留；资产要重新确认
export async function replacePhoto(old: Asset, file: File): Promise<{ ok: true; notes: string[] } | { ok: false; reason: string }> {
  const problem = checkFile(file, 0);
  if (problem) return { ok: false, reason: problem };
  try {
    const prepared = await prepareUpload(file);
    await replaceAsset(old, prepared);
    await mutateWork(old.workId, (c) => assetsChanged(c.work));
    void logEvent('replace_photo', old.workId);
    return { ok: true, notes: prepared.warnings };
  } catch (e) {
    return { ok: false, reason: errorText(e) };
  }
}
