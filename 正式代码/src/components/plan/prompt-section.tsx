'use client';

import { mutateWork } from '@/client/work-store';
import {
  backdropPromptStatus,
  backdropPromptWriteBlocker,
  PROMPT_NAMES,
  scenePromptStatus,
  scenePromptWriteBlocker,
} from '@/domain/approval';
import type { PromptKind } from '@/domain/types';
import { editPrompt, markPromptChecked, promptOf, revertPrompt } from '@/domain/work';
import { DraftTextarea } from '@/components/ui/draft-field';
import { useWorkspace } from '@/components/workspace/context';

// 提示词（背景、合成各一段，PRD AC-07.2、AC-07.2a）：由小间撰写，用户可以直接改；改后要核对，过期要重写或确认
export function PromptSection({ kind, locked }: { kind: PromptKind; locked: boolean }) {
  const { ctx, workId, askAgent, busy } = useWorkspace();
  const prompt = promptOf(ctx.work, kind);
  const name = PROMPT_NAMES[kind];
  const ps = kind === 'backdrop' ? backdropPromptStatus(ctx.work, ctx.backdropBasis) : scenePromptStatus(ctx.work, ctx.basis);
  // 小间写不了的时候说明原因，「让小间写」先灰掉，不白发一次请求（UX-02）
  const wait = kind === 'backdrop' ? backdropPromptWriteBlocker(ctx.work) : scenePromptWriteBlocker(ctx);
  const basisOf = (c: typeof ctx) => (kind === 'backdrop' ? c.backdropBasis : c.basis);

  const chip = {
    missing: <span className="chip">还没写</span>,
    stale: <span className="chip chip-warn">可能过期</span>,
    unchecked: <span className="chip chip-warn">待核对</span>,
    conflict: <span className="chip chip-bad">有矛盾</span>,
    ok: <span className="chip chip-ok">有效</span>,
  }[ps.kind];

  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-white px-5 py-[18px]" aria-labelledby={`prompt-${kind}-title`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`prompt-${kind}-title`} className="text-block font-semibold">
          {name}
        </h3>
        {chip}
        {prompt?.edited && <span className="chip">已手动修改</span>}
        <span className="ml-auto text-label text-muted">由小间撰写，你可以直接改</span>
      </div>
      {ps.kind === 'stale' && <p className="text-aux text-warn">写完后改了：{ps.changed.join('、')}。需要小间重写，或者你确认后再批准。</p>}
      {wait && (
        <p className="text-aux text-ink-2">
          {wait.text}，处理完小间才能{prompt?.text.trim() ? '改' : '写'}{name}。
        </p>
      )}
      {ps.kind === 'unchecked' && <p className="text-aux text-warn">你改过{name}，还没核对它和方案是否一致。</p>}
      {ps.kind === 'conflict' && (
        <ul className="list-disc pl-5 text-aux text-bad">
          {ps.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <label htmlFor={`prompt-${kind}`} className="sr-only">
        完整{name}
      </label>
      <DraftTextarea
        id={`prompt-${kind}`}
        name={`prompt-${kind}`}
        className="field min-h-24 font-mono text-aux leading-[1.8] text-ink-2"
        placeholder={`方案定好后，小间会在这里写出完整${name}`}
        disabled={locked}
        value={prompt?.text ?? ''}
        onCommit={(text) => text.trim() && void mutateWork(workId, (c) => editPrompt(c.work, kind, text, basisOf(c)))}
      />
      <div className="flex flex-wrap gap-2">
        {(ps.kind === 'missing' || ps.kind === 'stale') && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy || locked || !!wait}
            onClick={() => askAgent(ps.kind === 'missing' ? `请按现在的方案写${name}` : `方案改了，请按现在的方案重写${name}`)}
          >
            {ps.kind === 'missing' ? '让小间写' : '让小间重写'}
          </button>
        )}
        {/* 小间不可用时也能继续（AC-11.6）：自己对照改动，确认提示词仍然适用 */}
        {ps.kind === 'stale' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => markPromptChecked(c.work, kind, basisOf(c)))}>
            我核对过，仍然适用
          </button>
        )}
        {(ps.kind === 'unchecked' || ps.kind === 'conflict') && (
          <>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || locked} onClick={() => askAgent(`我改了${name}，帮我核对一下和方案是否一致`)}>
              让小间核对
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => markPromptChecked(c.work, kind, basisOf(c)))}>
              我已核对，两者一致
            </button>
          </>
        )}
        {prompt?.edited && prompt.original && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => revertPrompt(c.work, kind))}>
            撤销手改
          </button>
        )}
      </div>
    </section>
  );
}
