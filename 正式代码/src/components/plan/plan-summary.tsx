'use client';

import { imageModel } from '@/config/models';
import { STEP_NAMES } from '@/config/steps';
import { BACKDROP_KEYS, NO_PROPS, SCENE_KEYS, STYLE_SHORT, toneColors } from '@/config/style';
import { VIEW_ANGLES, VIEW_NAMES } from '@/config/views';
import { useBlobUrl } from '@/client/hooks';
import { approvalReminders, backdropApprovalBlockers, sceneApprovalBlockers } from '@/domain/approval';
import { currentView } from '@/domain/assets';
import type { PromptKind } from '@/domain/types';
import { BackdropThumb } from '@/components/ui/backdrop-thumb';
import { useWorkspace } from '@/components/workspace/context';

function Row({ label, children, muted = false }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[56px_1fr] gap-2.5 border-b border-line py-1 text-body last:border-b-0">
      <dt className="text-aux text-muted">{label}</dt>
      <dd className={muted ? 'text-placeholder' : ''}>{children}</dd>
    </div>
  );
}

function ViewMini({ id, label }: { id: string | undefined; label: string }) {
  const url = useBlobUrl(id);
  return (
    <span className="grid size-11 place-items-center overflow-hidden rounded-md bg-white shadow-[0_0_0_1px_var(--color-line)]" title={label}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的三视图
        <img src={url} alt={label} className="size-full object-contain" />
      ) : (
        <span className="text-label text-faint">缺</span>
      )}
    </span>
  );
}

// 背景方案（PRD AC-07.1）：色调、背景、光线、装饰道具、背景禁止项、张数
export function BackdropPlanSummary() {
  const { ctx } = useWorkspace();
  const { work } = ctx;
  const colors = toneColors(work.style.tone.value);
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
        <span>3:4</span>
        <span className="text-faint">·</span>
        <span>{imageModel(work.imageModel)?.label ?? work.imageModel}</span>
        <span className="text-faint">·</span>
        <span>两张背景，选一张</span>
      </div>
      <dl className="flex flex-col">
        {BACKDROP_KEYS.map((k) => {
          const v = work.style[k].value;
          return (
            <Row key={k} label={STYLE_SHORT[k]} muted={!v && k !== 'props'}>
              {v || (k === 'props' ? NO_PROPS : '未定')}
            </Row>
          );
        })}
        <Row label="固定">画面里没有任何饰品和文字，留出放饰品的位置</Row>
      </dl>
    </div>
  );
}

// 合成方案（PRD AC-07.1）：保真要求、所用背景图和三张三视图、摆放、构图、合成禁止项、比例、候选数量
export function PlanSummary({ compact = false }: { compact?: boolean }) {
  const { ctx } = useWorkspace();
  const { work } = ctx;
  const keep = work.info.keep.value;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 text-aux text-ink-2">
        <span>比例 {work.ratio}</span>
        <span className="text-faint">·</span>
        <span>{imageModel(work.imageModel)?.label ?? work.imageModel}</span>
        <span className="text-faint">·</span>
        <span>两张候选</span>
      </div>
      <div className="flex items-end gap-2.5">
        <div className="w-11 shrink-0">{ctx.backdrop ? <BackdropThumb backdrop={ctx.backdrop} /> : <span className="block aspect-[3/4] rounded-lg bg-soft" />}</div>
        {VIEW_ANGLES.map((a) => {
          const v = currentView(ctx.assets, work.id, a);
          return <ViewMini key={a} id={v?.confirmed ? v.thumbId : undefined} label={`${VIEW_NAMES[a]}三视图`} />;
        })}
        <span className="min-w-0 truncate pb-0.5 text-aux text-muted">{ctx.backdrop ? `背景「${ctx.backdrop.name}」＋三视图` : '还没选背景图'}</span>
      </div>
      <dl className="flex flex-col">
        {SCENE_KEYS.filter((k) => !compact || work.style[k].value || k !== 'bannedScene').map((k) => {
          const v = work.style[k];
          return (
            <Row key={k} label={STYLE_SHORT[k]} muted={!v.value}>
              {v.value || (k === 'bannedScene' ? '没写' : '未定')}
              {v.source === 'recommend' && v.value && <span className="ml-1.5 text-label text-accent">小间推荐</span>}
            </Row>
          );
        })}
        <Row label="保真">按三视图还原颜色、数量、轮廓和连接结构{keep ? `；特别注意：${keep}` : ''}</Row>
      </dl>
    </div>
  );
}

// 批准前还缺的（挡批准）和提醒（不挡批准）
export function BlockerList({ kind }: { kind: PromptKind }) {
  const { ctx, setViewing, viewing } = useWorkspace();
  const blockers = kind === 'backdrop' ? backdropApprovalBlockers(ctx) : sceneApprovalBlockers(ctx);
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
              去{STEP_NAMES[b.step]}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
