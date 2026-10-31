'use client';

import { useRef, useState } from 'react';
import { ASSET_KINDS, UPLOAD } from '@/config/upload';
import { useBlobUrl } from '@/client/hooks';
import { addPhotos } from '@/client/uploads';
import { mutateWork } from '@/client/work-store';
import { removeAsset, setAssetKind } from '@/data/repo';
import { activeUploads } from '@/domain/snapshot';
import type { Asset, AssetKind } from '@/domain/types';
import { assetsChanged, confirmAssets } from '@/domain/work';
import { useConfirm } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';

function PhotoCard({ asset, locked }: { asset: Asset; locked: boolean }) {
  const { workId } = useWorkspace();
  const confirm = useConfirm();
  const url = useBlobUrl(asset.blobId);
  const low = Math.max(asset.width, asset.height) < UPLOAD.lowEdge;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="relative grid aspect-square place-items-center overflow-hidden rounded-lg bg-soft-2">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的原图
          <img src={url} alt={`${ASSET_KINDS[asset.kind]}照片`} className="size-full object-contain" />
        )}
        {low && <span className="chip chip-warn absolute left-2 top-2">尺寸偏小</span>}
      </div>
      <figcaption className="flex items-center gap-1.5 text-aux text-ink-2">
        <label className="sr-only" htmlFor={`kind-${asset.id}`}>
          照片类型
        </label>
        <select
          id={`kind-${asset.id}`}
          className="h-6 rounded-full bg-white px-2 text-aux shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
          value={asset.kind}
          disabled={locked}
          onChange={async (e) => {
            await setAssetKind(asset, e.target.value as AssetKind);
            await mutateWork(workId, (c) => assetsChanged(c.work));
          }}
        >
          {Object.entries(ASSET_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-label text-muted tabular-nums">
          {asset.width}×{asset.height}
        </span>
        <button
          type="button"
          className="icon-btn ml-auto"
          aria-label="不再使用这张照片"
          title="不再使用这张照片（原图记录保留）"
          disabled={locked}
          onClick={async () => {
            const ok = await confirm({
              title: '不再使用这张照片？',
              body: '原图记录会保留；资产和之后的方案需要重新确认。',
              ok: '不再使用',
            });
            if (!ok) return;
            await removeAsset(asset);
            await mutateWork(workId, (c) => assetsChanged(c.work));
          }}
        >
          <Icon name="trash" />
        </button>
      </figcaption>
    </figure>
  );
}

// 资产（PRD FR-02）：多张参考图、类型标注、对照检查后确认才可用；原图始终保留
export function AssetStep() {
  const { ctx, workId, setViewing } = useWorkspace();
  const uploads = activeUploads(ctx.assets, workId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const locked = ctx.isGenerating;

  return (
    <div>
      <StepHead step="asset">
        {uploads.length > 0 && <span className={ctx.work.assetsConfirmed ? 'chip chip-ok' : 'chip chip-warn'}>{ctx.work.assetsConfirmed ? '已确认' : '待确认'}</span>}
      </StepHead>
      {uploads.length === 0 ? (
        <div className="flex min-h-[52vh] flex-col items-center justify-center gap-1.5 text-center text-muted">
          <Icon name="image" className="mb-1.5 size-7 text-faint [stroke-width:1.2]" />
          <strong className="text-block font-medium text-ink-2">还没有作品照片</strong>
          <span className="text-aux">先上传一张整体照，背景乱一点没关系；有背面或细节照更好</span>
          <button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            上传照片
          </button>
        </div>
      ) : (
        <>
          <p className="mb-3.5 text-aux text-muted">
            对照检查：颜色、形状、细链、镂空、透明部分和数量都拍清楚了吗？看不清的部分小间不会去猜，建议补拍。
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {uploads.map((a) => (
              <PhotoCard key={a.id} asset={a} locked={locked} />
            ))}
            {uploads.length < UPLOAD.maxCount && (
              <button
                type="button"
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg bg-white text-aux text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink disabled:hover:text-muted"
                disabled={locked}
                onClick={() => fileRef.current?.click()}
              >
                <span className="grid size-7 place-items-center rounded-full bg-black text-white">
                  <Icon name="plus" className="size-[15px]" />
                </span>
                再加一张
              </button>
            )}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={ctx.work.assetsConfirmed || locked}
              onClick={async () => {
                await mutateWork(workId, (c) => confirmAssets(c.work));
                setViewing(null);
              }}
            >
              {ctx.work.assetsConfirmed ? '资产已确认' : '确认资产'}
            </button>
            <span className="text-aux text-muted">
              {ctx.work.route === 'A' ? '白底路线：确认后用白底图生成' : '原图路线：确认后用这些照片作参考图'}
            </span>
          </div>
        </>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-aux text-warn" aria-live="polite">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD.types.join(',')}
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) setNotes((await addPhotos(workId, files)).notes);
        }}
      />
    </div>
  );
}
