'use client';

import { imageModel } from '@/config/models';
import { NO_PROPS, toneColors } from '@/config/style';
import { approvalBlockers, approvalReminders } from '@/domain/approval';
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
  // 从某张结果修改时，生成会带上那张图作房间参考（BC-006），批准前写明
  const room = work.revision && ctx.results.find((r) => r.id === work.revision!.fromResultId);
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
      {room && (
        <p className="text-aux text-ink-2">
          沿用第 {room.round} 轮候选 {room.slot + 1} 的房间和机位
        </p>
      )}
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

// 批准前还缺的（挡批准）和提醒（不挡批准）
export function BlockerList() {
  const { ctx, setViewing, viewing } = useWorkspace();
  const blockers = approvalBlockers(ctx.work, ctx.assets, ctx.basis, ctx.isGenerating);
  const reminders = approvalReminders(ctx.work);
  if (!blockers.length && !reminders.length) return null;
  const rows = [...blockers.map((b) => ({ ...b, lead: '还缺', tone: 'text-warn' })), ...reminders.map((b) => ({ ...b, lead: '提醒', tone: 'text-ink-2' }))];
  return (
    <ul className="flex flex-col gap-1 text-aux">
      {rows.map((b) => (
        <li key={b.text} className={`flex items-center gap-2 ${b.tone}`}>
          <span>
            {b.lead}：{b.text}
          </span>
          {b.step !== viewing && (
            <button type="button" className="shrink-0 text-ink-2 underline decoration-line-hover underline-offset-2 hover:text-ink" onClick={() => setViewing(b.step)}>
              去{STEPS.find((s) => s.id === b.step)?.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
