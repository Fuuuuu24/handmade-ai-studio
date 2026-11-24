import { isViewAngle } from '@/config/views';
import { addUpload, logEvent, replaceAsset, setPhotoKind } from '@/data/repo';
import { activeUploads } from '@/domain/assets';
import type { Asset, AssetKind } from '@/domain/types';
import { errorText } from './api';
import { checkFile, prepareUpload } from './images';
import { loadContext } from './work-store';

// 添加作品照片：逐张校验。首页和对话里上传的先进「未分类」，用户在商品画布里选类型（技术写法 13.3）；
// 商品画布上点某个角度的空位上传时直接放进那个角度。换了照片，受影响的三视图自然作废（domain/assets.ts）
export async function addPhotos(workId: string, files: File[], kind: AssetKind = 'unsorted'): Promise<{ assetIds: string[]; notes: string[] }> {
  const ctx = await loadContext(workId);
  let count = activeUploads(ctx.assets, workId).length;
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
      // 角度只放一张：第一张放进去（顶替原来那张，原来的退回「未分类」），其余的进「未分类」；细节照可以有好几张
      const angle = isViewAngle(kind);
      const asset = await addUpload(workId, angle ? 'unsorted' : kind, prepared);
      if (angle && !assetIds.length) await setPhotoKind(asset, kind);
      assetIds.push(asset.id);
      count += 1;
      notes.push(...prepared.warnings.map((w) => `「${file.name}」${w}`));
    } catch (e) {
      notes.push(`「${file.name}」没有加上：${errorText(e)}`);
    }
  }
  if (assetIds.length) void logEvent('upload', workId, { count: assetIds.length });
  return { assetIds, notes };
}

// 替换原图（PRD 4.2 第 5 条）：用户确认后调用；新增一条同类型的记录，旧的标记为被替换、原图保留。
// 这个角度的三视图随之作废，要重新生成（domain/assets.ts 的 currentView）
export async function replacePhoto(old: Asset, file: File): Promise<{ ok: true; notes: string[] } | { ok: false; reason: string }> {
  const problem = checkFile(file, 0);
  if (problem) return { ok: false, reason: problem };
  try {
    const prepared = await prepareUpload(file);
    await replaceAsset(old, prepared);
    void logEvent('replace_photo', old.workId, { kind: old.kind });
    return { ok: true, notes: prepared.warnings };
  } catch (e) {
    return { ok: false, reason: errorText(e) };
  }
}
