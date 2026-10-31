'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { imageModel } from '@/config/models';
import { ISSUES } from '@/config/verdict';
import { useBlobUrl } from '@/client/hooks';
import { retrySlot } from '@/client/generation';
import { db } from '@/data/db';
import { getBlob, logEvent, updateResult } from '@/data/repo';
import { approvalStatus } from '@/domain/approval';
import { passed, roundSlots, slotState } from '@/domain/generation';
import type { Approval, Result, Verdict } from '@/domain/types';
import { useWorkspace } from '@/components/workspace/context';
import { Icon } from '@/components/ui/icon';
import { StepHead } from './canvas';

const ratioClass = { '1:1': 'aspect-square', '3:4': 'aspect-[3/4]', '9:16': 'aspect-[9/16]' } as const;

function VerdictRow({ label, value, okText, badText, onPick }: { label: string; value: Verdict; okText: string; badText: string; onPick: (v: Verdict) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <strong className="w-12 font-medium">{label}</strong>
      <button type="button" className="mini-btn ok" aria-pressed={value === 'ok'} onClick={() => onPick(value === 'ok' ? 'none' : 'ok')}>
        {okText}
      </button>
      <button type="button" className="mini-btn bad" aria-pressed={value === 'bad'} onClick={() => onPick(value === 'bad' ? 'none' : 'bad')}>
        {badText}
      </button>
    </div>
  );
}

function Candidate({ result, ratio }: { result: Result; ratio: keyof typeof ratioClass }) {
  const { ctx, askAgent, busy } = useWorkspace();
  const url = useBlobUrl(result.blobId);
  const [note, setNote] = useState(result.note);
  const ok = passed(result);
  const anyBad = result.verdict.real === 'bad' || result.verdict.style === 'bad';
  const save = (patch: Partial<Result>) => void updateResult({ ...result, ...patch });

  const pick = (kind: 'real' | 'style', v: Verdict) => {
    const verdict = { ...result.verdict, [kind]: v };
    save({ verdict });
    void logEvent('verdict', result.workId, { round: result.round, slot: result.slot, real: verdict.real, style: verdict.style });
  };
  const toggleIssue = (issue: string) =>
    save({ issues: result.issues.includes(issue) ? result.issues.filter((i) => i !== issue) : [...result.issues, issue] });

  const download = async () => {
    const blob = await getBlob(result.blobId);
    if (!blob) return;
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ctx.work.name}-第${result.round}轮-候选${result.slot + 1}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    save({ exports: [...result.exports, Date.now()] });
    void logEvent('export', result.workId, { round: result.round, slot: result.slot });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <a href={url ?? undefined} target="_blank" rel="noreferrer" className={`grid ${ratioClass[ratio]} cursor-zoom-in place-items-center overflow-hidden rounded-lg bg-soft`} aria-label={`查看候选 ${result.slot + 1} 大图`}>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的生成结果
          <img src={url} alt={`候选 ${result.slot + 1}`} className="size-full object-cover" />
        )}
      </a>
      <div className="flex flex-col gap-1.5 text-aux text-ink-2">
        <VerdictRow label="像实物" value={result.verdict.real} okText="像" badText="不像" onPick={(v) => pick('real', v)} />
        <VerdictRow label="风格" value={result.verdict.style} okText="对" badText="不对" onPick={(v) => pick('style', v)} />
        {anyBad && (
          <>
            <div className="flex flex-wrap gap-1">
              {[...(result.verdict.real === 'bad' ? ISSUES.real : []), ...(result.verdict.style === 'bad' ? ISSUES.style : [])].map((i) => (
                <button key={i} type="button" className="choice !h-6 !px-2.5 !text-aux" aria-pressed={result.issues.includes(i)} onClick={() => toggleIssue(i)}>
                  {i}
                </button>
              ))}
            </div>
            <input
              className="field !min-h-7 !text-aux"
              name={`note-${result.id}`}
              aria-label="具体哪里不对"
              placeholder="具体哪里不对？比如：链子变长了"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== result.note && save({ note })}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm self-start"
              disabled={busy}
              onClick={() => {
                if (note !== result.note) save({ note });
                const parts = [
                  result.verdict.real === 'bad' ? '不像实物' : '',
                  result.verdict.style === 'bad' ? '风格不对' : '',
                  result.issues.length ? `问题在${result.issues.join('、')}` : '',
                  note.trim(),
                ].filter(Boolean);
                askAgent(`候选 ${result.slot + 1}：${parts.join('，')}。帮我改一下方案。`);
              }}
            >
              告诉小间哪里不对
            </button>
          </>
        )}
        {ok && (
          <button type="button" className="btn btn-primary btn-sm mt-1 self-start" onClick={() => void download()}>
            <Icon name="download" />
            导出这张
          </button>
        )}
      </div>
    </div>
  );
}

function FailedSlot({ round, slot, error }: { round: number; slot: number; error?: string }) {
  const { workId } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg bg-bad-bg p-3 text-aux text-bad">
      <p>候选 {slot + 1} 没有生成出来：{error ?? '原因未知'}</p>
      <button
        type="button"
        className="mini-btn"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const r = await retrySlot(workId, round, slot);
          setPending(false);
          setReason(r.ok ? null : r.reasons.join('；'));
        }}
      >
        {pending ? '提交中…' : '补齐这一张'}
      </button>
      {reason && <p className="text-warn">{reason}</p>}
    </div>
  );
}

function Round({ round, approval, isCurrent }: { round: number; approval: Approval | undefined; isCurrent: boolean }) {
  const { ctx, workId } = useWorkspace();
  const ratio = approval?.snapshot.ratio ?? ctx.work.ratio;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-aux text-muted">
        <h3 className="text-block font-semibold text-ink">第 {round} 轮</h3>
        {approval && (
          <span>
            第 {approval.version} 版方案 · {ratio} · {imageModel(approval.snapshot.imageModel)?.label ?? approval.snapshot.imageModel} · 路线 {approval.snapshot.route}
          </span>
        )}
        {!isCurrent && <span className="chip">基于之前的方案</span>}
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,320px))] gap-5">
        {roundSlots().map((slot) => {
          const result = ctx.results.find((r) => r.round === round && r.slot === slot);
          if (result) return <Candidate key={slot} result={result} ratio={ratio} />;
          const st = slotState(ctx.tasks, workId, round, slot);
          const last = ctx.tasks.filter((t) => t.round === round && t.slot === slot).sort((a, b) => a.attempt - b.attempt).at(-1);
          if (st === 'failed') return <FailedSlot key={slot} round={round} slot={slot} error={last?.error} />;
          return (
            <div key={slot} className={`grid ${ratioClass[ratio]} place-items-center rounded-lg bg-soft`}>
              <div className="flex flex-col items-center gap-1.5 text-aux text-muted">
                <span className="spinner" aria-hidden="true" />
                {last?.status === 'queued' ? '正在提交…' : '生成中，通常要一两分钟'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// 出图（PRD FR-08、FR-09）：每次两张，状态如实显示；每张分别验收还原度和风格，两项都满意才算完成
export function OutputStep() {
  const { ctx, workId } = useWorkspace();
  const approvals = useLiveQuery(() => db().approvals.where('workId').equals(workId).toArray(), [workId]) ?? [];
  const rounds = [...new Set(ctx.tasks.filter((t) => t.kind === 'scene' && t.round != null).map((t) => t.round!))].sort((a, b) => b - a);
  const valid = approvalStatus(ctx.approval, ctx.snapshot).kind === 'valid';

  return (
    <div className="flex flex-col gap-8">
      <StepHead step="output" />
      {rounds.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-1.5 text-center text-muted">
          <Icon name="image" className="mb-1.5 size-7 text-faint [stroke-width:1.2]" />
          <strong className="text-block font-medium text-ink-2">还没有生成结果</strong>
          <span className="text-aux">方案批准后会在这里出现两张候选</span>
        </div>
      ) : (
        rounds.map((r) => {
          const approval = approvals.find((a) => a.usedRound === r);
          return <Round key={r} round={r} approval={approval} isCurrent={valid && ctx.approval?.usedRound === r} />;
        })
      )}
    </div>
  );
}
