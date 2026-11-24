'use client';

import { useBlobFailed, useBlobUrl } from '@/client/hooks';
import type { BackdropRef } from '@/domain/types';
import { MissingImage } from './missing-image';

const NEUTRAL = ['#eeeeee', '#dddddd', '#cccccc'];

// 背景图（3:4）：数据库里的读缩略图（full 时读原图）；内置模板有图就显示图，图还没提供时用示意色块并标「示意，待替换」
export function BackdropThumb({ backdrop, full = false, className = '' }: { backdrop: BackdropRef; full?: boolean; className?: string }) {
  const id = backdrop.builtin ? null : full ? backdrop.blobId : backdrop.thumbId;
  const url = useBlobUrl(id);
  const missing = useBlobFailed(id);
  const box = `relative grid aspect-[3/4] w-full grid-cols-1 grid-rows-1 place-items-center overflow-hidden rounded-lg bg-soft ${className}`;
  if (backdrop.builtin && !backdrop.image) {
    const [a, b, c] = backdrop.colors ?? NEUTRAL;
    return (
      <div className={box} style={{ background: `linear-gradient(135deg, ${a}, ${b} 60%, ${c})` }} role="img" aria-label={`背景图「${backdrop.name}」（示意色块）`}>
        <span className="absolute bottom-2 left-2 rounded-md bg-white/85 px-1.5 text-label text-muted">示意，待替换</span>
      </div>
    );
  }
  const src = backdrop.builtin ? backdrop.image : url;
  return (
    <div className={box}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的背景图或 public 下的内置模板
        <img src={src} alt={`背景图「${backdrop.name}」`} className="size-full object-cover" />
      )}
      {missing && <MissingImage />}
    </div>
  );
}
