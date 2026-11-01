'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ReactNode } from 'react';
import { imageModel } from '@/config/models';
import type { Ratio } from '@/config/ratios';
import { NO_PROPS, STYLE_LABELS } from '@/config/style';
import { ISSUES } from '@/config/verdict';
import { useBlobUrl } from '@/client/hooks';
import { retrySlot } from '@/client/generation';
import { mutateWork } from '@/client/work-store';
import { db } from '@/data/db';
import { logEvent, patchResult } from '@/data/repo';
import { exportResult } from '@/client/export';
import { approvalStatus } from '@/domain/approval';
import { passed, roundSlots, slotState } from '@/domain/generation';
import { activeUploads } from '@/domain/snapshot';
import type { Approval, Result, Verdict } from '@/domain/types';
import { reviseFrom } from '@/domain/work';
import { useWorkspace } from '@/components/workspace/context';
import { Modal } from '@/components/ui/dialog';
import { DraftInput } from '@/components/ui/draft-field';
import { Icon } from '@/components/ui/icon';
import { StepHead } from './canvas';

const ratioClass = { '1:1': 'aspect-square', '3:4': 'aspect-[3/4]', '9:16': 'aspect-[9/16]' } as const;

const PLAN_ROWS = ['tone', 'background', 'light', 'placement', 'props', 'banned', 'composition'] as const;

function VerdictRow({ label, value, okText, badText, onPick, extra }: { label: string; value: Verdict; okText: string; badText: string; onPick: (v: Verdict) => void; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <strong className="w-12 font-medium">{label}</strong>
      <button type="button" className="mini-btn ok" aria-pressed={value === 'ok'} onClick={() => onPick(value === 'ok' ? 'none' : 'ok')}>
        {okText}
      </button>
      <button type="button" className="mini-btn bad" aria-pressed={value === 'bad'} onClick={() => onPick(value === 'bad' ? 'none' : 'bad')}>
        {badText}
      </button>
      {extra}
    </div>
  );
}

// 对照原图（AC-09.1）：生成时用的参考图和候选并排看
function CompareModal({ open, onClose, result, approval }: { open: boolean; onClose: () => void; result: Result; approval: Approval | undefined }) {
  const { ctx } = useWorkspace();
  const refId = approval?.snapshot.references[0];
  const ref = ctx.assets.find((a) => a.id === refId) ?? activeUploads(ctx.assets, ctx.work.id)[0];
  const refUrl = useBlobUrl(open ? ref?.blobId : null);
  const url = useBlobUrl(open ? result.blobId : null);
  const frame = 'grid h-[min(64vh,640px)] place-items-center overflow-hidden rounded-lg bg-soft';
  return (
    <Modal open={open} onClose={onClose} wide title={`对照原图：第 ${result.round} 轮候选 ${result.slot + 1}`} sub="看颜色、数量、轮廓、连接结构、纹样和材质有没有走样">
      <div className="grid grid-cols-2 gap-4">
        <figure className="m-0 flex flex-col gap-1.5">
          <div className={frame}>
            {refUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的原图
              <img src={refUrl} alt="原图" className="size-full object-contain" />
            )}
          </div>
          <figcaption className="text-aux text-muted">{approval?.snapshot.references[0] === ref?.id ? '生成时用的参考图' : '原图'}</figcaption>
        </figure>
        <figure className="m-0 flex flex-col gap-1.5">
          <div className={frame}>
            {url && (
              // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的生成结果
              <img src={url} alt={`候选 ${result.slot + 1}`} className="size-full object-contain" />
            )}
          </div>
          <figcaption className="text-aux text-muted">候选 {result.slot + 1}</figcaption>
        </figure>
      </div>
    </Modal>
  );
}

function Candidate({ result, ratio, approval }: { result: Result; ratio: Ratio; approval: Approval | undefined }) {
  const { ctx, workId, askAgent, busy, setViewing } = useWorkspace();
  const url = useBlobUrl(result.blobId);
  const noteRef = useRef<HTMLInputElement>(null);
  const [comparing, setComparing] = useState(false);
  const ok = passed(result);
  const anyBad = result.verdict.real === 'bad' || result.verdict.style === 'bad';
  const locked = ctx.isGenerating;
  const parent = result.parentId ? ctx.results.find((r) => r.id === result.parentId) : undefined;
  // 每次只改自己的字段，基于数据库里的最新记录（连着点「像」「对」不会互相覆盖）
  const patch = (fn: (r: Result) => void) => void patchResult(result.id, fn);
  const saveNote = (note: string) =>
    patch((r) => {
      r.note = note;
    });

  const pick = (kind: 'real' | 'style', v: Verdict) => {
    patch((r) => {
      r.verdict = { ...r.verdict, [kind]: v };
    });
    void logEvent('verdict', result.workId, { round: result.round, slot: result.slot, kind, value: v });
  };
  const toggleIssue = (issue: string) =>
    patch((r) => {
      r.issues = r.issues.includes(issue) ? r.issues.filter((i) => i !== issue) : [...r.issues, issue];
    });

  // 从这一版修改（AC-09.4）：恢复那一版的方案并记下父结果，原结果保留
  const revise = async () => {
    if (!approval || locked) return;
    await mutateWork(workId, (c) => reviseFrom(c.work, result, approval));
    void logEvent('revise', workId, { round: result.round, slot: result.slot });
  };

  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const download = async () => {
    setExportProblem(null);
    const r = await exportResult(ctx.work.name, result);
    if (!r.ok) setExportProblem(`没有导出：${r.reason}`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <a href={url ?? undefined} target="_blank" rel="noreferrer" className={`grid ${ratioClass[ratio]} cursor-zoom-in place-items-center overflow-hidden rounded-lg bg-soft`} aria-label={`查看候选 ${result.slot + 1} 大图`}>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的生成结果
          <img src={url} alt={`候选 ${result.slot + 1}`} className="size-full object-cover" />
        )}
      </a>
      {parent && (
        <p className="-mt-1 text-label text-muted">
          改自第 {parent.round} 轮候选 {parent.slot + 1}
        </p>
      )}
      <div className="flex flex-col gap-1.5 text-aux text-ink-2">
        <VerdictRow
          label="像实物"
          value={result.verdict.real}
          okText="像"
          badText="不像"
          onPick={(v) => pick('real', v)}
          extra={
            <button type="button" className="ml-auto text-aux text-muted underline decoration-line-hover underline-offset-2 hover:text-ink" onClick={() => setComparing(true)}>
              对照原图
            </button>
          }
        />
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
            <DraftInput
              ref={noteRef}
              className="field !min-h-7 !text-aux"
              name={`note-${result.id}`}
              aria-label="具体哪里不对"
              placeholder="具体哪里不对？比如：链子变长了"
              value={result.note}
              onCommit={saveNote}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm self-start"
              disabled={busy || locked}
              onClick={async () => {
                const note = (noteRef.current?.value ?? result.note).trim();
                if (note !== result.note) saveNote(note);
                await revise();
                const parts = [
                  result.verdict.real === 'bad' ? '不像实物' : '',
                  result.verdict.style === 'bad' ? '风格不对' : '',
                  result.issues.length ? `问题在${result.issues.join('、')}` : '',
                  note,
                ].filter(Boolean);
                askAgent(`第 ${result.round} 轮候选 ${result.slot + 1}：${parts.join('，')}。帮我改一下方案。`);
              }}
            >
              告诉小间哪里不对
            </button>
          </>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {ok && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void download()}>
              <Icon name="download" />
              导出这张
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={locked || !approval}
            title={locked ? '正在生成，等这一轮结束再改' : '恢复这一张当时的方案，改好后重新批准；原结果会保留'}
            onClick={async () => {
              await revise();
              setViewing('plan');
            }}
          >
            从这一版修改
          </button>
        </div>
        {exportProblem && (
          <p role="alert" className="text-aux text-bad">
            {exportProblem}
          </p>
        )}
      </div>
      <CompareModal open={comparing} onClose={() => setComparing(false)} result={result} approval={approval} />
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

// 这一轮批准时的方案：验收风格时对照（AC-09.1），也是结果的来历（AC-10.3）
function RoundPlan({ approval }: { approval: Approval }) {
  const s = approval.snapshot;
  return (
    <details className="text-aux text-ink-2">
      <summary className="w-fit cursor-pointer select-none text-muted hover:text-ink">这一轮的方案</summary>
      <dl className="mt-2 grid max-w-[720px] grid-cols-[64px_1fr] gap-x-3 gap-y-1">
        {PLAN_ROWS.map((k) => (
          <div key={k} className="contents">
            <dt className="text-muted">{STYLE_LABELS[k]}</dt>
            <dd>{s.style[k] || (k === 'props' ? NO_PROPS : '—')}</dd>
          </div>
        ))}
        {s.summary && (
          <>
            <dt className="text-muted">想表达</dt>
            <dd>{s.summary.express}</dd>
            <dt className="text-muted">感受</dt>
            <dd>{s.summary.feel || '—'}</dd>
            <dt className="text-muted">避免</dt>
            <dd>{s.summary.avoid || '—'}</dd>
          </>
        )}
        <dt className="text-muted">提示词</dt>
        <dd className="whitespace-pre-wrap font-mono text-label leading-relaxed text-muted">{s.prompt}</dd>
      </dl>
    </details>
  );
}

function Round({ round, approval, isCurrent }: { round: number; approval: Approval | undefined; isCurrent: boolean }) {
  const { ctx, workId } = useWorkspace();
  const ratio = approval?.snapshot.ratio ?? ctx.work.ratio;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-aux text-muted">
          <h3 className="text-block font-semibold text-ink">第 {round} 轮</h3>
          {approval && (
            <span>
              第 {approval.version} 版方案 · {ratio} · {imageModel(approval.snapshot.imageModel)?.label ?? approval.snapshot.imageModel} · 路线 {approval.snapshot.route}
            </span>
          )}
          {!isCurrent && <span className="chip">基于之前的方案</span>}
        </div>
        {approval && <RoundPlan approval={approval} />}
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,320px))] gap-5">
        {roundSlots().map((slot) => {
          const result = ctx.results.find((r) => r.round === round && r.slot === slot);
          if (result) return <Candidate key={slot} result={result} ratio={ratio} approval={approval} />;
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
