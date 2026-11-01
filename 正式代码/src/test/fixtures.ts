import { builtinScene } from '@/config/scenes';
import { basisOf, snapshotOf } from '@/domain/snapshot';
import type { Asset, AssetKind, Id, Result, Task, Work } from '@/domain/types';
import { newId } from '@/domain/util';
import { confirmAssets, confirmSummary, draftSummary, newWork, setInfo, writePrompt } from '@/domain/work';

export const MAX_REFS = 4;

export function upload(workId: Id, kind: AssetKind = 'overall', extra: Partial<Asset> = {}): Asset {
  return {
    id: newId('asset'),
    workId,
    origin: 'upload',
    kind,
    blobId: newId('blob'),
    thumbId: newId('blob'),
    width: 1600,
    height: 1200,
    mime: 'image/jpeg',
    bytes: 500_000,
    createdAt: Date.now(),
    removed: false,
    ...extra,
  };
}

export function white(workId: Id, parentId: Id): Asset {
  return { ...upload(workId, 'overall'), origin: 'white', parentId, method: 'generate' };
}

// 除提示词外都已就绪的作品（B 路线，一张整体图）
export function readyWork(): { work: Work; assets: Asset[] } {
  const scene = builtinScene('tpl-moss')!;
  let work = newWork({ imageModel: 'img-a', chatModel: 'chat-a', route: 'B', scene: { id: scene.id, params: scene.params } });
  const assets = [upload(work.id)];
  work = confirmAssets(work);
  work = setInfo(work, 'category', '耳饰');
  work = setInfo(work, 'material', '黄铜镀金');
  work = setInfo(work, 'size', '长 4.5cm');
  work = draftSummary(work, { express: '雨后青苔', feel: '安静', avoid: '太花' });
  work = confirmSummary(work);
  return { work, assets };
}

// 就绪并写好提示词
export function promptedWork(): { work: Work; assets: Asset[] } {
  const { work, assets } = readyWork();
  return { work: writePrompt(work, '一件手作耳饰……', basisOf(work, assets, MAX_REFS)), assets };
}

export const current = (work: Work, assets: readonly Asset[]) => snapshotOf(work, assets, MAX_REFS);
export const currentBasis = (work: Work, assets: readonly Asset[]) => basisOf(work, assets, MAX_REFS);

export function task(workId: Id, round: number, slot: number, status: Task['status'], attempt = 1): Task {
  return {
    id: newId('task'),
    workId,
    kind: 'scene',
    approvalId: 'apv',
    round,
    slot,
    attempt,
    model: 'img-a',
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function result(workId: Id, round: number, slot: number, verdict: Result['verdict'] = { real: 'none', style: 'none' }): Result {
  return {
    id: newId('res'),
    workId,
    taskId: newId('task'),
    approvalId: 'apv',
    round,
    slot,
    blobId: newId('blob'),
    width: 1024,
    height: 1024,
    verdict,
    issues: [],
    note: '',
    createdAt: Date.now(),
    exports: [],
  };
}
