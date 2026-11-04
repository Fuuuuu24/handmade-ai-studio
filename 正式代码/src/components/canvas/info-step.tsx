'use client';

import { INFO_CORE, INFO_FIELDS, INFO_KEYS, INFO_REQUIRED, type InfoKey } from '@/config/info';
import { mutateWork } from '@/client/work-store';
import { infoReady, pendingCore, pendingSuggestions } from '@/domain/info';
import type { Work } from '@/domain/types';
import { acceptSuggestion, dismissSuggestion, markUnknown, removeFollowup, setInfo } from '@/domain/work';
import { DraftInput, DraftTextarea } from '@/components/ui/draft-field';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';
import WarmTooltip from '@/components/bits/WarmTooltip/WarmTooltip';

const OPTIONAL: readonly InfoKey[] = ['price', 'audience'];

function InfoRow({ k }: { k: InfoKey }) {
  const { ctx, workId, setViewing } = useWorkspace();
  const field = ctx.work.info[k];
  // 逐条处理小间的建议时停在这一步：还有别的建议就不跟着跳走，最后一条处理完再跟到当前该做的一步（BC-002）
  const decide = (fn: (w: Work, key: InfoKey) => Work) => {
    setViewing(pendingSuggestions(ctx.work.info).some((x) => x !== k) ? 'info' : null);
    void mutateWork(workId, (c) => fn(c.work, k));
  };
  const required = (INFO_REQUIRED as readonly InfoKey[]).includes(k);
  const missing = required && !field.value && !field.unknown;
  // 核心信息锁进了批准快照，生成中不能改；售价、目标顾客不影响生成，随时可改
  const locked = ctx.isGenerating && (INFO_CORE as readonly InfoKey[]).includes(k);
  const common = {
    id: `info-${k}`,
    name: k,
    value: field.unknown ? '' : field.value,
    placeholder: field.unknown ? '已标为未知' : INFO_FIELDS[k].placeholder,
    disabled: field.unknown || locked,
    onCommit: (v: string) => void mutateWork(workId, (c) => setInfo(c.work, k, v)),
    className: 'field',
  };

  return (
    <div className="grid grid-cols-[96px_1fr] items-start gap-2.5 border-b border-line py-2 last:border-b-0">
      <label htmlFor={`info-${k}`} className="flex flex-col gap-0.5 pt-1.5 text-aux text-muted">
        {INFO_FIELDS[k].label}
        {missing && <em className="text-label not-italic text-warn">需要你补</em>}
        {OPTIONAL.includes(k) && <em className="text-label not-italic">选填</em>}
      </label>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2">
          {k === 'keep' ? <DraftTextarea {...common} rows={2} /> : <DraftInput {...common} />}
          {required && (
            <label className="mt-1.5 flex shrink-0 items-center gap-1 text-aux text-muted">
              <input
                type="checkbox"
                checked={field.unknown}
                disabled={locked}
                onChange={(e) => void mutateWork(workId, (c) => markUnknown(c.work, k, e.target.checked))}
              />
              未知
            </label>
          )}
        </div>
        {field.suggestion && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-aux">
            <span className="text-accent">小间建议</span>
            <span className="text-ink">{field.suggestion.value}</span>
            {field.suggestion.note && <span className="text-muted">（{field.suggestion.note}）</span>}
            <span className="ml-auto flex gap-1.5">
              <button type="button" className="mini-btn" disabled={locked} onClick={() => decide(acceptSuggestion)}>
                接受
              </button>
              <button type="button" className="mini-btn" onClick={() => decide(dismissSuggestion)}>
                忽略
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// 商品信息（PRD FR-03）：核心字段可标未知；小间写的只是建议，接受后才生效；售价与目标顾客选填
export function InfoStep() {
  const { ctx } = useWorkspace();
  const ready = infoReady(ctx.work.info);
  const pending = pendingCore(ctx.work.info).length > 0;
  return (
    <div>
      <StepHead step="info">
        <span className={ready && !pending ? 'chip chip-ok' : 'chip chip-warn'}>{!ready ? '待补充' : pending ? '有建议待确认' : '已填好'}</span>
      </StepHead>
      {ctx.isGenerating && <p className="-mt-2 mb-3 text-aux text-muted">正在生成这一轮，品类、材料、尺寸和不能改的细节暂时锁定。</p>}
      <div className="max-w-[640px] rounded-xl bg-white px-5 py-3">
        {INFO_KEYS.map((k) => (
          <InfoRow key={k} k={k} />
        ))}
      </div>
      <p className="mt-3 text-aux text-muted">改动材料、尺寸或不能改的细节后，已经写好的提示词和批准需要重新确认。</p>
      <Followups />
    </div>
  );
}

// 本期不支持、先记下的需求（AC-02.5，比如真人佩戴）：不进提示词，也不影响批准
function Followups() {
  const { ctx, workId } = useWorkspace();
  const list = ctx.work.followups ?? [];
  if (!list.length) return null;
  return (
    <section className="mt-8 flex max-w-[640px] flex-col gap-2">
      <h3 className="text-block font-semibold">记下的后续需求</h3>
      <p className="text-aux text-muted">本期先不做，记下来给以后的版本参考；不会写进这次的提示词。</p>
      <ul className="flex flex-col gap-1 text-body text-ink-2">
        {list.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">{f.text}</span>
            <WarmTooltip content="删掉">
              <button type="button" className="icon-btn !size-6" aria-label={`删掉「${f.text}」`} onClick={() => void mutateWork(workId, (c) => removeFollowup(c.work, f.id))}>
                <Icon name="close" className="size-3.5" />
              </button>
            </WarmTooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}
