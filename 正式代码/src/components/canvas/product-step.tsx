'use client';

import { useRef, useState } from 'react';
import { ASSET_KINDS, UPLOAD } from '@/config/upload';
import { VIEW_ANGLES, VIEW_NAMES, VIEWS, type ViewAngle } from '@/config/views';
import { generateViews } from '@/client/generation';
import { useBlobFailed, useBlobUrl } from '@/client/hooks';
import { addPhotos, replacePhoto } from '@/client/uploads';
import { confirmView, removeAsset, setPhotoKind } from '@/data/repo';
import { activeUploads, angleState, anglesToGenerate, viewCheck, type AngleState } from '@/domain/assets';
import type { Asset, AssetKind } from '@/domain/types';
import { Modal, useConfirm } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { MissingImage } from '@/components/ui/missing-image';
import { useWorkspace } from '@/components/workspace/context';
import { NextStep, StepHead } from './canvas';
import WarmTooltip from '@/components/bits/WarmTooltip/WarmTooltip';
import GlideSelect from '@/components/bits/GlideSelect/GlideSelect';

const KIND_OPTIONS = (['front', 'side', 'back', 'detail', 'unsorted'] as const).map((value) => ({ value, label: ASSET_KINDS[value] }));

// 照片本身：缩略图，替换、停用（都要确认，原图记录保留，PRD 4.2 第 5 条）
function Photo({ asset, locked, kindSelect = false }: { asset: Asset; locked: boolean; kindSelect?: boolean }) {
  const confirm = useConfirm();
  const replaceRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const url = useBlobUrl(asset.thumbId);
  const missing = useBlobFailed(asset.thumbId);
  const low = Math.max(asset.width, asset.height) < UPLOAD.lowEdge;
  const name = `${ASSET_KINDS[asset.kind]}照片`;
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="relative grid aspect-square grid-cols-1 grid-rows-1 place-items-center overflow-hidden rounded-lg bg-soft-2">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的原图
          <img src={url} alt={name} className="size-full object-contain" />
        )}
        {missing && <MissingImage />}
        {low && <span className="chip chip-warn absolute left-2 top-2">尺寸偏小</span>}
      </div>
      <figcaption className="flex items-center gap-1 text-aux text-ink-2">
        {kindSelect ? (
          <GlideSelect
            ariaLabel="照片类型"
            size="sm"
            menuWidth={112}
            options={KIND_OPTIONS}
            value={asset.kind}
            disabled={locked}
            onChange={(v) => void setPhotoKind(asset, v as AssetKind)}
          />
        ) : (
          <span className="text-label tabular-nums text-muted">
            {asset.width}×{asset.height}
          </span>
        )}
        <WarmTooltip content="换一张更清楚的（原图记录保留）">
          <button type="button" className="icon-btn ml-auto" aria-label={`替换${name}`} disabled={locked} onClick={() => replaceRef.current?.click()}>
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
              title: `替换${name}？`,
              body: '新照片会顶替它，原图记录保留；这个角度的三视图要重新生成，之后的方案需要重新确认。',
              ok: '替换',
            });
            if (!ok) return;
            const r = await replacePhoto(asset, file);
            setNote(r.ok ? (r.notes[0] ?? null) : `没有替换：${r.reason}`);
          }}
        />
        <WarmTooltip content="不再使用这张照片（原图记录保留）">
          <button
            type="button"
            className="icon-btn"
            aria-label={`不再使用这张${name}`}
            disabled={locked}
            onClick={async () => {
              const ok = await confirm({ title: '不再使用这张照片？', body: '原图记录会保留；用它生成的三视图和之后的方案需要重新确认。', ok: '不再使用' });
              if (ok) await removeAsset(asset);
            }}
          >
            <Icon name="trash" />
          </button>
        </WarmTooltip>
      </figcaption>
      {note && <p className="text-label text-warn">{note}</p>}
    </figure>
  );
}

// 对照三视图（AC-02.3）：同角度的原图和三视图并排放大，逐张确认或重做
function ViewCompare({ open, onClose, state, onRedo, redoProblem }: { open: boolean; onClose: () => void; state: AngleState; onRedo: () => void; redoProblem: string | null }) {
  const a = useBlobUrl(open ? state.photo?.blobId : null);
  const b = useBlobUrl(open ? state.view?.blobId : null);
  const name = VIEW_NAMES[state.angle];
  // 行列写成 minmax(0,1fr)：默认的 auto 行会按图片原高撑开，框比图矮时下沿被裁掉（BC-012）
  const frame = 'grid h-[min(60vh,600px)] grid-cols-1 grid-rows-1 place-items-center overflow-hidden rounded-lg bg-soft';
  const view = state.view;
  return (
    <Modal open={open} onClose={onClose} wide title={`对照${name}三视图`} sub="看镂空、细链、透明部分、轮廓和数量有没有走样，有没有被裁掉">
      <div className="grid grid-cols-2 gap-4">
        {[
          [a, `${name}原图`, state.photo],
          [b, `${name}三视图（生图模型重画，可能改动细节）`, view],
        ].map(([url, label, asset]) => (
          <figure key={label as string} className="m-0 flex flex-col gap-1.5">
            <div className={frame}>
              {url && (
                // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的图片
                <img src={url as string} alt={label as string} className="size-full object-contain" />
              )}
            </div>
            <figcaption className="flex items-center gap-2 text-aux text-muted">
              <span className="min-w-0 flex-1">{label as string}</span>
              {url && asset && (
                <a href={url as string} target="_blank" rel="noreferrer" className="underline decoration-line-hover underline-offset-2 hover:text-ink">
                  看原尺寸 {(asset as Asset).width}×{(asset as Asset).height}
                </a>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {view && !view.confirmed && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-autofocus
            onClick={async () => {
              await confirmView(view);
              onClose();
            }}
          >
            可以用
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" onClick={onRedo}>
          重做这张
        </button>
        {redoProblem && <span className="text-aux text-warn">{redoProblem}</span>}
        <span className="ml-auto text-label text-muted">还原度最后按原图验收；这里先看三视图能不能用</span>
      </div>
    </Modal>
  );
}

// 一个角度：照片位（空着时上传），下面是这个角度的三视图
function AngleColumn({ angle, locked }: { angle: ViewAngle; locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const s = angleState(ctx.assets, ctx.tasks, workId, angle);
  const viewUrl = useBlobUrl(s.view?.thumbId);
  const name = VIEW_NAMES[angle];
  const redo = async () => {
    setProblem(null);
    const r = await generateViews(workId, [angle]);
    if (!r.ok) setProblem(r.reason);
    else setOpen(false);
  };
  const left = VIEWS.perAngle - s.attempts;

  return (
    <div className="flex min-w-0 flex-col gap-2.5" role="group" aria-labelledby={`angle-${angle}`}>
      <h3 id={`angle-${angle}`} className="text-aux font-medium text-ink-2">
        {name}
      </h3>
      {s.photo ? (
        <Photo asset={s.photo} locked={locked} />
      ) : (
        <button
          type="button"
          className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg bg-white text-aux text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink disabled:hover:text-muted"
          disabled={locked}
          onClick={() => fileRef.current?.click()}
        >
          <span className="grid size-7 place-items-center rounded-full bg-black text-white">
            <Icon name="plus" className="size-[15px]" />
          </span>
          上传{name}照片
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD.types.join(',')}
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) setNotes((await addPhotos(workId, files.slice(0, 1), angle)).notes);
        }}
      />
      {notes.length > 0 && <p className="text-label text-warn">{notes.join('；')}</p>}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          className={`grid aspect-square grid-cols-1 grid-rows-1 place-items-center overflow-hidden rounded-lg bg-white ${
            s.view?.confirmed ? 'shadow-[0_0_0_1.5px_var(--color-ink)]' : 'shadow-[inset_0_0_0_1px_var(--color-line)]'
          } ${s.view ? 'cursor-zoom-in' : 'cursor-default'}`}
          aria-label={s.view ? `对照${name}三视图` : `${name}三视图`}
          disabled={!s.view}
          onClick={() => setOpen(true)}
        >
          {s.view && viewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的三视图
            <img src={viewUrl} alt="" className="size-full object-contain" />
          ) : s.generating ? (
            <span className="flex items-center gap-1.5 text-aux text-muted">
              <span className="spinner !size-3" aria-hidden="true" />
              生成中
            </span>
          ) : (
            <span className="text-label text-faint">三视图</span>
          )}
        </button>
        <div className="flex min-h-6 flex-wrap items-center gap-1.5 text-aux">
          {s.view && (s.view.confirmed ? <span className="chip chip-ok">已确认</span> : <span className="chip chip-warn">待确认</span>)}
          {s.view && s.generating && <span className="text-label text-muted">重做中…</span>}
          {s.view && !s.view.confirmed && !s.generating && (
            <button type="button" className="mini-btn" onClick={() => setOpen(true)}>
              对照确认
            </button>
          )}
          {(s.view || s.failed) && !s.generating && (
            <button type="button" className="mini-btn" disabled={locked || left <= 0} title={left > 0 ? `还能生成 ${left} 次` : '这张照片已经生成到上限'} onClick={() => void redo()}>
              重做
            </button>
          )}
        </div>
        {s.failed && <p className="text-label text-bad">没生成出来：{s.failed}</p>}
        {problem && !open && <p className="text-label text-warn">{problem}</p>}
      </div>
      {s.view && <ViewCompare open={open} onClose={() => setOpen(false)} state={s} onRedo={() => void redo()} redoProblem={problem} />}
    </div>
  );
}

// 生成三视图（用户点按钮，小间只能提议）：做还没有三视图的角度；缺照片时不能点，写明缺哪张（AC-02.1）
export function GenerateViewsButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { ctx, workId } = useWorkspace();
  const [problem, setProblem] = useState<string | null>(null);
  const todo = anglesToGenerate(ctx.assets, ctx.tasks, workId);
  const check = viewCheck(ctx.assets, ctx.tasks, workId, todo, ctx.busy);
  const generating = ctx.busy.views;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={`btn btn-primary ${size === 'sm' ? 'btn-sm' : ''}`}
        disabled={!check.ok}
        title="按每个角度的照片生成一张白底图，每张要花一张图的钱"
        onClick={async () => {
          setProblem(null);
          const r = await generateViews(workId);
          if (!r.ok) setProblem(r.reason);
        }}
      >
        {generating ? '三视图生成中…' : '生成三视图'}
      </button>
      <span className="text-aux text-muted">{check.ok ? `生成 ${todo.length} 张白底图（${todo.map((a) => VIEW_NAMES[a]).join('、')}），出来后逐张对照确认` : check.reason}</span>
      {problem && <span className="text-aux text-warn">{problem}</span>}
    </div>
  );
}

// 商品（PRD FR-02、4.3）：正面、侧面、背面三张照片都要有，各生成一张白底三视图，逐张对照确认；合成只用三视图
export function ProductStep() {
  const { ctx, workId } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<string[]>([]);
  // 三视图生成中锁照片；合成生成中三视图锁进了快照，照片也不能动
  const locked = ctx.busy.views || ctx.busy.scene;
  const uploads = activeUploads(ctx.assets, workId);
  const extra = uploads.filter((a) => a.kind === 'detail' || a.kind === 'unsorted');
  const states = VIEW_ANGLES.map((a) => angleState(ctx.assets, ctx.tasks, workId, a));
  const confirmed = states.filter((s) => s.view?.confirmed).length;

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <StepHead step="product">
        <span className={confirmed === 3 ? 'chip chip-ok' : 'chip chip-warn'}>三视图 {confirmed}/3 已确认</span>
      </StepHead>
      <p className="-mt-4 text-aux text-muted">正面、侧面、背面三张照片都要有；每张生成一张白底三视图，对照原图确认后用于合成。看不清的部分小间不会去猜，建议补拍。</p>
      <div className="grid grid-cols-[repeat(3,minmax(0,196px))] gap-5">
        {VIEW_ANGLES.map((a) => (
          <AngleColumn key={a} angle={a} locked={locked} />
        ))}
      </div>
      {states.some((s) => !s.view) && <GenerateViewsButton />}

      <section className="flex flex-col gap-2.5" aria-labelledby="extra-photos">
        <div className="flex items-baseline gap-2">
          <h3 id="extra-photos" className="text-block font-semibold">
            细节照和未分类
          </h3>
          <span className="text-aux text-muted">细节照只给小间看，帮它理解商品，不进合成；首页和对话里传的照片先放这里，选好类型</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,148px))] gap-4">
          {extra.map((a) => (
            <Photo key={a.id} asset={a} locked={locked} kindSelect />
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
              加细节照
            </button>
          )}
        </div>
      </section>
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-aux text-warn" aria-live="polite">
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
          if (files.length) setNotes((await addPhotos(workId, files, 'detail')).notes);
        }}
      />
      <NextStep step="product" />
    </div>
  );
}
