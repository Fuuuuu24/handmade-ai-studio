'use client';

import { RATIOS, RATIO_NOTES } from '@/config/ratios';
import { BUILTIN_SCENES } from '@/config/scenes';
import { NO_PROPS, STYLE_KEYS, STYLE_LABELS, STYLE_OPTIONS, type StyleKey } from '@/config/style';
import { mutateWork } from '@/client/work-store';
import { approvalStatus, promptStatus } from '@/domain/approval';
import { styleConflicts } from '@/domain/conflicts';
import { styleValuesOf } from '@/domain/snapshot';
import type { StyleSource } from '@/domain/types';
import { applyScene, editPrompt, markPromptChecked, revertPrompt, setRatio, setStyle } from '@/domain/work';
import { ApproveButton } from '@/components/plan/approve-button';
import { DraftInput, DraftTextarea } from '@/components/ui/draft-field';
import { BlockerList } from '@/components/plan/plan-summary';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';

const SOURCE_TAG: Partial<Record<StyleSource, [string, string]>> = {
  recommend: ['小间推荐', 'text-accent'],
  said: ['你说的', 'text-muted'],
  scene: ['布景', 'text-muted'],
  shop: ['我的风格', 'text-muted'],
};

function StyleRow({ k, locked }: { k: StyleKey; locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const v = ctx.work.style[k];
  const options = STYLE_OPTIONS[k] ?? [];
  const tag = v.value ? SOURCE_TAG[v.source] : undefined;
  const set = (value: string) => void mutateWork(workId, (c) => setStyle(c.work, k, value, 'user'));

  return (
    <div className="grid grid-cols-[64px_1fr] items-start gap-3 border-b border-line py-2.5 last:border-b-0">
      <div className="flex flex-col gap-0.5 pt-1">
        <label htmlFor={`style-${k}`} className="text-aux text-muted">
          {STYLE_LABELS[k]}
        </label>
        {tag && (
          <span className={`text-label ${tag[1]}`} title={v.reason}>
            {tag[0]}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button key={o} type="button" className="choice" aria-pressed={v.value === o} disabled={locked} onClick={() => set(o)}>
                {o}
              </button>
            ))}
          </div>
        )}
        <DraftInput
          id={`style-${k}`}
          name={k}
          className="field"
          disabled={locked}
          placeholder={k === 'props' ? NO_PROPS : k === 'banned' ? '比如：花、玻璃器皿' : options.length ? '或者用自己的话描述' : '用自己的话描述'}
          value={v.value}
          onCommit={(text) => text.trim() !== v.value && set(text)}
        />
        {v.reason && v.source === 'recommend' && <p className="text-label text-muted">理由：{v.reason}</p>}
      </div>
    </div>
  );
}

function PromptSection({ locked }: { locked: boolean }) {
  const { ctx, workId, askAgent, busy } = useWorkspace();
  const prompt = ctx.work.prompt;
  const ps = promptStatus(ctx.work, ctx.basis);

  const chip = {
    missing: <span className="chip">还没写</span>,
    stale: <span className="chip chip-warn">可能过期</span>,
    unchecked: <span className="chip chip-warn">待核对</span>,
    conflict: <span className="chip chip-bad">有矛盾</span>,
    ok: <span className="chip chip-ok">有效</span>,
  }[ps.kind];

  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-white px-5 py-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-block font-semibold">提示词</h3>
        {chip}
        {prompt?.edited && <span className="chip">已手动修改</span>}
        <span className="ml-auto text-label text-muted">由小间撰写，你可以直接改</span>
      </div>
      {ps.kind === 'stale' && <p className="text-aux text-warn">写完后改了：{ps.changed.join('、')}。需要小间重写，或者你确认后再批准。</p>}
      {ps.kind === 'unchecked' && <p className="text-aux text-warn">你改过提示词，还没核对它和上面的方案是否一致。</p>}
      {ps.kind === 'conflict' && (
        <ul className="list-disc pl-5 text-aux text-bad">
          {ps.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <label htmlFor="prompt-text" className="sr-only">
        完整提示词
      </label>
      <DraftTextarea
        id="prompt-text"
        name="prompt"
        className="field min-h-24 font-mono text-aux leading-[1.8] text-ink-2"
        placeholder="风格定好后，小间会在这里写出完整提示词"
        disabled={locked}
        value={prompt?.text ?? ''}
        onCommit={(text) => text.trim() && void mutateWork(workId, (c) => editPrompt(c.work, text, c.basis))}
      />
      <div className="flex flex-wrap gap-2">
        {(ps.kind === 'missing' || ps.kind === 'stale') && (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || locked} onClick={() => askAgent(ps.kind === 'missing' ? '请按现在的方案写提示词' : '方案改了，请按现在的方案重写提示词')}>
            {ps.kind === 'missing' ? '让小间写' : '让小间重写'}
          </button>
        )}
        {(ps.kind === 'unchecked' || ps.kind === 'conflict') && (
          <>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || locked} onClick={() => askAgent('我改了提示词，帮我核对一下和方案是否一致')}>
              让小间核对
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => markPromptChecked(c.work, c.basis))}>
              我已核对，两者一致
            </button>
          </>
        )}
        {prompt?.edited && prompt.original && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => revertPrompt(c.work))}>
            撤销手改
          </button>
        )}
      </div>
    </section>
  );
}

// 方案（PRD FR-05、FR-07、FR-08）：风格卡与对话是同一份数据；批准绑定快照，改动后旧批准失效
export function PlanStep() {
  const { ctx, workId } = useWorkspace();
  const { work } = ctx;
  const locked = ctx.isGenerating;
  const conflicts = styleConflicts(styleValuesOf(work));
  const ap = approvalStatus(ctx.approval, ctx.snapshot);

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <StepHead step="plan">
        {ap.kind === 'valid' && <span className="chip chip-ok">第 {ctx.approval!.version} 版已批准</span>}
        {ap.kind === 'stale' && <span className="chip chip-warn">批准已失效</span>}
      </StepHead>
      {ap.kind === 'stale' && <p className="-mt-3 text-aux text-warn">批准后改了：{ap.changed.join('、')}。需要重新批准才能生成。</p>}
      {locked && <p className="-mt-3 text-aux text-muted">正在生成这一轮，方案锁定中。</p>}

      <section className="flex flex-col gap-2">
        <h3 className="text-block font-semibold">摄影布景</h3>
        <div className="flex flex-wrap gap-2">
          {BUILTIN_SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="choice gap-2"
              aria-pressed={work.sceneId === s.id}
              disabled={locked}
              title={s.desc}
              onClick={() => void mutateWork(workId, (c) => applyScene(c.work, s.id, s.params))}
            >
              <span className="inline-flex overflow-hidden rounded-sm" aria-hidden="true">
                {s.colors.map((c) => (
                  <i key={c} className="h-3 w-2" style={{ background: c }} />
                ))}
              </span>
              {s.name}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white px-5 py-2">
        {STYLE_KEYS.map((k) => (
          <StyleRow key={k} k={k} locked={locked} />
        ))}
      </section>
      {conflicts.length > 0 && (
        <ul className="-mt-2 list-disc pl-5 text-aux text-warn">
          {conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <h3 className="text-block font-semibold">比例</h3>
        <div className="segmented" role="group" aria-label="主图比例">
          {RATIOS.map((r) => (
            <button key={r} type="button" aria-pressed={work.ratio === r} disabled={locked} title={RATIO_NOTES[r]} onClick={() => void mutateWork(workId, (c) => setRatio(c.work, r))}>
              {r}
            </button>
          ))}
        </div>
        <span className="text-aux text-muted">{RATIO_NOTES[work.ratio]}</span>
      </section>

      <PromptSection locked={locked} />

      <section className="flex flex-col gap-2.5">
        <BlockerList />
        <ApproveButton />
      </section>
    </div>
  );
}
