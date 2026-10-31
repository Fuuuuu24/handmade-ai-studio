'use client';

import { imageModel } from '@/config/models';
import { NO_PROPS, toneColors } from '@/config/style';
import { approvalBlockers } from '@/domain/approval';
import { STEPS } from '@/config/steps';
import { useWorkspace } from '@/components/workspace/context';

const ROWS = [
  ['tone', '色调'],
  ['background', '背景'],
  ['light', '光线'],
  ['placement', '摆放'],
  ['props', '道具'],
  ['banned', '禁止'],
  ['composition', '构图'],
] as const;

// 可读方案（AC-07.1）：保真要求、背景、光线、摆放、道具、构图、比例、候选数量
export function PlanSummary({ compact = false }: { compact?: boolean }) {
  const { ctx } = useWorkspace();
  const { work } = ctx;
  const colors = toneColors(work.style.tone.value);
  const keep = work.info.keep.value;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-aux text-ink-2">
        {colors && (
          <span className="inline-flex overflow-hidden rounded" aria-hidden="true">
            {colors.map((c) => (
              <i key={c} className="h-4 w-3" style={{ background: c }} />
            ))}
          </span>
        )}
        <span>比例 {work.ratio}</span>
        <span className="text-faint">·</span>
        <span>{imageModel(work.imageModel)?.label ?? work.imageModel}</span>
        <span className="text-faint">·</span>
        <span>两张候选</span>
      </div>
      <dl className="flex flex-col">
        {ROWS.filter(([k]) => !compact || work.style[k].value || k === 'props').map(([k, label]) => {
          const v = work.style[k];
          const shown = v.value || (k === 'props' ? NO_PROPS : '未定');
          return (
            <div key={k} className="grid grid-cols-[48px_1fr] gap-2.5 border-b border-line py-1 text-body last:border-b-0">
              <dt className="text-aux text-muted">{label}</dt>
              <dd className={v.value || k === 'props' ? '' : 'text-placeholder'}>
                {shown}
                {v.source === 'recommend' && v.value && <span className="ml-1.5 text-label text-accent">小间推荐</span>}
              </dd>
            </div>
          );
        })}
        <div className="grid grid-cols-[48px_1fr] gap-2.5 py-1 text-body">
          <dt className="text-aux text-muted">保真</dt>
          <dd>按参考图还原颜色、数量、轮廓和连接结构{keep ? `；特别注意：${keep}` : ''}</dd>
        </div>
      </dl>
    </div>
  );
}

export function BlockerList() {
  const { ctx, setViewing } = useWorkspace();
  const blockers = approvalBlockers(ctx.work, ctx.assets, ctx.basis, ctx.isGenerating);
  if (!blockers.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-aux text-warn">
      {blockers.map((b) => (
        <li key={b.text} className="flex items-center gap-2">
          <span>还缺：{b.text}</span>
          <button type="button" className="text-ink-2 underline decoration-line-hover underline-offset-2 hover:text-ink" onClick={() => setViewing(b.step)}>
            去{STEPS.find((s) => s.id === b.step)?.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
