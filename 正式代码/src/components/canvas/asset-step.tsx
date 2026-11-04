'use client';

import { useRef, useState } from 'react';
import { ASSET_KINDS, UPLOAD } from '@/config/upload';
import { makeWhiteByGeneration } from '@/client/generation';
import { useBlobFailed, useBlobUrl } from '@/client/hooks';
import { addPhotos, replacePhoto } from '@/client/uploads';
import { mutateWork } from '@/client/work-store';
import { removeAsset, setAssetKind } from '@/data/repo';
import { isActive } from '@/domain/generation';
import { activeUploads } from '@/domain/snapshot';
import type { Asset, AssetKind, Route } from '@/domain/types';
import { whiteCheck, whitesOf, whiteTasks } from '@/domain/white';
import { assetsChanged, chooseWhite, confirmAssets, setRoute } from '@/domain/work';
import { Modal, useConfirm } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { MissingImage } from '@/components/ui/missing-image';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';
import WarmTooltip from '@/components/bits/WarmTooltip/WarmTooltip';
import GlideSelect from '@/components/bits/GlideSelect/GlideSelect';

function PhotoCard({ asset, locked }: { asset: Asset; locked: boolean }) {
  const { workId } = useWorkspace();
  const confirm = useConfirm();
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceNote, setReplaceNote] = useState<string | null>(null);
  const url = useBlobUrl(asset.thumbId);
  const missing = useBlobFailed(asset.thumbId);
  const low = Math.max(asset.width, asset.height) < UPLOAD.lowEdge;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="relative grid aspect-square grid-cols-1 grid-rows-1 place-items-center overflow-hidden rounded-lg bg-soft-2">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的原图
          <img src={url} alt={`${ASSET_KINDS[asset.kind]}照片`} className="size-full object-contain" />
        )}
        {missing && <MissingImage />}
        {low && <span className="chip chip-warn absolute left-2 top-2">尺寸偏小</span>}
      </div>
      <figcaption className="flex items-center gap-1.5 text-aux text-ink-2">
        <GlideSelect
          ariaLabel="照片类型"
          size="sm"
          menuWidth={112}
          options={Object.entries(ASSET_KINDS).map(([value, label]) => ({ value, label }))}
          value={asset.kind}
          disabled={locked}
          onChange={async (v) => {
            await setAssetKind(asset, v as AssetKind);
            await mutateWork(workId, (c) => assetsChanged(c.work));
          }}
        />
        <span className="text-label text-muted tabular-nums">
          {asset.width}×{asset.height}
        </span>
        <WarmTooltip content="换一张更清楚的（原图记录保留）">
          <button
            type="button"
            className="icon-btn ml-auto"
            aria-label="替换这张照片"
            disabled={locked}
            onClick={() => replaceRef.current?.click()}
          >
            <Icon name="retry" />
          </button>
        </WarmTooltip>
        <input
          ref={replaceRef}
          type="file"
          accept={UPLOAD.types.join(',')}
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const ok = await confirm({
              title: '替换这张照片？',
              body: '新照片会顶替它用在方案里，原图记录保留；资产和之后的方案需要重新确认。',
              ok: '替换',
            });
            if (!ok) return;
            const r = await replacePhoto(asset, file);
            setReplaceNote(r.ok ? (r.notes[0] ?? null) : `没有替换：${r.reason}`);
          }}
        />
        <WarmTooltip content="不再使用这张照片（原图记录保留）">
          <button
            type="button"
            className="icon-btn"
            aria-label="不再使用这张照片"
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
        </WarmTooltip>
      </figcaption>
      {replaceNote && <p className="text-label text-warn">{replaceNote}</p>}
    </figure>
  );
}

// 白底图对照（AC-02.3）：原图和白底图并排放大看
function WhiteCompare({ open, onClose, parent, white }: { open: boolean; onClose: () => void; parent: Asset; white: Asset }) {
  const a = useBlobUrl(open ? parent.blobId : null);
  const b = useBlobUrl(open ? white.blobId : null);
  // 行列写成 minmax(0,1fr)：默认的 auto 行会按图片原高撑开，框比图矮时下沿被裁掉（BC-012，和出图的对照原图同一个问题）
  const frame = 'grid h-[min(64vh,640px)] grid-cols-1 grid-rows-1 place-items-center overflow-hidden rounded-lg bg-soft';
  return (
    <Modal open={open} onClose={onClose} wide title="对照白底图" sub="看镂空、细链、透明部分、轮廓和数量有没有走样，有没有被裁掉">
      <div className="grid grid-cols-2 gap-4">
        {[
          [a, '原图'],
          [b, '白底图（生图模型重画，可能改动细节）'],
        ].map(([url, label]) => (
          <figure key={label} className="m-0 flex flex-col gap-1.5">
            <div className={frame}>
              {url && (
                // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的图片
                <img src={url} alt={label!} className="size-full object-contain" />
              )}
            </div>
            <figcaption className="text-aux text-muted">{label}</figcaption>
          </figure>
        ))}
      </div>
    </Modal>
  );
}

function WhiteThumb({ parent, white, locked }: { parent: Asset; white: Asset; locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const confirm = useConfirm();
  const url = useBlobUrl(white.thumbId);
  const [open, setOpen] = useState(false);
  const chosen = ctx.work.whiteChoice === white.id;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={`grid aspect-square w-[76px] cursor-zoom-in place-items-center overflow-hidden rounded-md bg-white ${chosen ? 'shadow-[0_0_0_1.5px_var(--color-ink)]' : 'shadow-[0_0_0_1px_var(--color-line)]'}`}
        aria-label="对照原图查看白底图"
        onClick={() => setOpen(true)}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的白底图
          <img src={url} alt="" className="size-full object-contain" />
        )}
      </button>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="mini-btn"
          aria-pressed={chosen}
          disabled={locked || chosen}
          onClick={() => void mutateWork(workId, (c) => chooseWhite(c.work, white.id))}
        >
          {chosen ? '已选用' : '用这张'}
        </button>
        <WarmTooltip content="不再使用这张白底图">
          <button
            type="button"
            className="icon-btn !size-6"
            aria-label="不再使用这张白底图"
            disabled={locked}
            onClick={async () => {
              const ok = await confirm({ title: '不再使用这张白底图？', body: '原图不受影响。', ok: '不再使用' });
              if (!ok) return;
              await removeAsset(white);
              if (chosen) await mutateWork(workId, (c) => chooseWhite(c.work, null));
            }}
          >
            <Icon name="trash" className="size-3.5" />
          </button>
        </WarmTooltip>
      </div>
      <WhiteCompare open={open} onClose={() => setOpen(false)} parent={parent} white={white} />
    </div>
  );
}

// A 路线：每张整体或背面照下面做白底、对照、选用（技术写法第 7 节）。抠图做法还没接入，只有生图白底
function WhitePanel({ parent }: { parent: Asset }) {
  const { ctx, workId } = useWorkspace();
  const [reason, setReason] = useState<string | null>(null);
  const whites = whitesOf(ctx.assets, parent.id);
  const tasks = whiteTasks(ctx.tasks, parent.id);
  const last = tasks.at(-1);
  const active = last && isActive(last);
  const check = whiteCheck(ctx.work, ctx.assets, ctx.tasks, parent.id, ctx.isGenerating);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex items-center gap-2 text-aux">
        <span className="text-muted">白底图</span>
        <button
          type="button"
          className="mini-btn ml-auto"
          disabled={!check.ok}
          title={check.ok ? '用生图模型按这张照片出一张白底图（要花一张图的钱）' : check.reason}
          onClick={async () => {
            setReason(null);
            const r = await makeWhiteByGeneration(workId, parent.id);
            if (!r.ok) setReason(r.reason);
          }}
        >
          {active ? '正在做…' : whites.length ? '再做一张' : '生图白底'}
        </button>
      </div>
      {whites.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {whites.map((w) => (
            <WhiteThumb key={w.id} parent={parent} white={w} locked={ctx.isGenerating} />
          ))}
        </div>
      )}
      {active && (
        <p className="flex items-center gap-1.5 text-label text-muted">
          <span className="spinner !size-3" aria-hidden="true" />
          生成中，通常要一两分钟
        </p>
      )}
      {last?.status === 'failed' && <p className="text-label text-bad">上一次没做出来：{last.error ?? '原因未知'}</p>}
      {reason && <p className="text-label text-warn">{reason}</p>}
    </div>
  );
}

// 资产路线（PRD 4.3、AC-02.6）：只给试用操作员看，切换后资产要重新确认
function RouteSwitch() {
  const { ctx, workId, config } = useWorkspace();
  if (!config?.operator) return null;
  const options: [Route, string][] = [
    ['A', 'A 白底'],
    ['B', 'B 原图'],
  ];
  return (
    <div className="mb-4 flex items-center gap-2.5 text-aux text-muted">
      <span>资产路线（试用操作员）</span>
      <div className="segmented" role="group" aria-label="资产路线">
        {options.map(([r, label]) => (
          <button key={r} type="button" aria-pressed={ctx.work.route === r} disabled={ctx.isGenerating} onClick={() => void mutateWork(workId, (c) => setRoute(c.work, r))}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 资产（PRD FR-02）：多张参考图、类型标注、对照检查后确认才可用；原图始终保留
export function AssetStep() {
  const { ctx, workId, setViewing } = useWorkspace();
  const uploads = activeUploads(ctx.assets, workId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const locked = ctx.isGenerating;
  const routeA = ctx.work.route === 'A';
  const needWhite = routeA && !ctx.basis.references.includes(ctx.work.whiteChoice ?? '');

  return (
    <div>
      <RouteSwitch />
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
              <div key={a.id} className="flex flex-col gap-2.5">
                <PhotoCard asset={a} locked={locked} />
                {routeA && a.kind !== 'detail' && <WhitePanel parent={a} />}
              </div>
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
              disabled={ctx.work.assetsConfirmed || locked || needWhite}
              onClick={async () => {
                await mutateWork(workId, (c) => confirmAssets(c.work));
                setViewing(null);
              }}
            >
              {ctx.work.assetsConfirmed ? '资产已确认' : '确认资产'}
            </button>
            <span className="text-aux text-muted">
              {routeA
                ? needWhite
                  ? '白底路线：先给整体照做一张白底图，对照原图后选用'
                  : '白底路线：确认后用选用的白底图和细节照生成'
                : '原图路线：确认后用这些照片作参考图'}
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
