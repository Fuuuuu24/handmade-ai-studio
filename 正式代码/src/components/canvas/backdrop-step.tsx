'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listedBuiltins } from '@/config/backdrops';
import { BACKDROP_KEYS } from '@/config/style';
import { pickBackdrop, saveToLibrary } from '@/client/backdrops';
import { retrySlot } from '@/client/generation';
import { useBlobUrl } from '@/client/hooks';
import { mutateWork } from '@/client/work-store';
import { listSavedBackdrops, logEvent } from '@/data/repo';
import { backdropConflicts } from '@/domain/conflicts';
import { backdropApprovalStatus } from '@/domain/approval';
import { backdropCandidates, backdropDone, backdropLag, refOfBackdrop, refOfBuiltin } from '@/domain/backdrops';
import { slotsOf, slotState } from '@/domain/generation';
import { backdropStyleOf } from '@/domain/snapshot';
import type { Backdrop, BackdropMode, BackdropRef, StorySummary } from '@/domain/types';
import { clearBackdrop, confirmSummary, editSummary, keepStyleForSummary, setBackdropMode, setNoStory, styleLagsSummary } from '@/domain/work';
import { ApproveButton } from '@/components/plan/approve-button';
import { BackdropPlanSummary, BlockerList } from '@/components/plan/plan-summary';
import { PromptSection } from '@/components/plan/prompt-section';
import { StyleRow } from '@/components/plan/style-row';
import { BackdropThumb } from '@/components/ui/backdrop-thumb';
import { useConfirm } from '@/components/ui/dialog';
import { DraftTextarea } from '@/components/ui/draft-field';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/components/workspace/context';
import { NextStep, StepHead } from './canvas';
import RefineFrame from '@/components/bits/RefineFrame/RefineFrame';

const PARTS: [keyof StorySummary, string, string][] = [
  ['express', '作品想表达什么', '比如：雨后石阶上的一小片青苔，安静、湿润的绿'],
  ['feel', '希望顾客感受到什么', '比如：安静、自然，想凑近看细节'],
  ['avoid', '明确避免什么', '比如：太亮太花，道具抢了耳环'],
];
const KIND_TEXT = { inspiration: '灵感', theme: '主题', emotion: '情绪', other: '其他' } as const;
const EMPTY: StorySummary = { express: '', feel: '', avoid: '' };

const paramsLine = (r: BackdropRef) =>
  r.params ? BACKDROP_KEYS.map((k) => r.params![k]).filter(Boolean).join('，') || '没有写参数' : '示意模板，无参数';

// 背景的做法（技术写法 13.4）：用模板库里的，或自己生成。换做法会清掉已选的背景图；
// 套用模板进来的作品改成自己生成时切到首页开始的流程，已有的照片、三视图和信息都保留（AC-06.6）
function ModeSwitch({ locked }: { locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const confirm = useConfirm();
  const { work } = ctx;
  const choose = async (mode: BackdropMode) => {
    if (mode === work.backdropMode) return;
    const toHome = work.flow === 'template' && mode === 'generate';
    if (toHome || work.backdropId) {
      const ok = await confirm({
        title: toHome ? '改成自己生成背景？' : '换一种做法？',
        body: toHome
          ? '作品会改走首页开始的流程（商品 → 信息 → 背景 → 摆放 → 出图），已有的照片、三视图和信息都保留；现在选的模板会清掉。'
          : '现在选的背景图会先清掉，之后还可以再选回来。',
        ok: toHome ? '改成自己生成' : '换',
      });
      if (!ok) return;
    }
    await mutateWork(workId, (c) => setBackdropMode(c.work, mode));
    void logEvent('backdrop_mode', workId, { mode, flowChanged: toHome });
  };
  return (
    <div className="segmented self-start" role="group" aria-label="背景的做法">
      {(
        [
          ['library', '用模板库里的'],
          ['generate', '自己生成'],
        ] as const
      ).map(([m, label]) => (
        <button key={m} type="button" aria-pressed={work.backdropMode === m} disabled={locked} onClick={() => void choose(m)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// 现在用的背景图：名称、来源、参数（AC-06.1）；自己生成的可以「重新设计背景」
function CurrentBackdrop({ locked }: { locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const ref = ctx.backdrop;
  if (!ctx.work.backdropId) return null;
  if (!ref) return <p className="text-aux text-bad">选定的背景图找不到了，请重新选一张。</p>;
  const own = !ref.builtin && ref.workId === workId;
  const lag = backdropLag(ctx);
  return (
    <div className="flex items-start gap-4 rounded-xl bg-white p-3.5">
      <div className="w-[88px] shrink-0">
        <BackdropThumb backdrop={ref} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-aux text-ink-2">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-ink">{ref.name}</span>
          <span className="chip">{ref.builtin ? '内置模板' : own ? '这件作品生成的' : '模板库'}</span>
          {ref.deleted && <span className="chip chip-warn">已从模板库删除</span>}
        </div>
        <p>{paramsLine(ref)}</p>
        {lag.length > 0 && <p className="text-warn">背景是按旧的内容生成的：之后改了{lag.join('、')}。想跟着变就重新设计背景。</p>}
        {ctx.work.backdropMode === 'generate' && (
          <div className="mt-1">
            <button type="button" className="btn btn-outline btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => clearBackdrop(c.work))}>
              重新设计背景
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 用模板库里的：内置模板和自己沉淀的背景图，点一张就用（PRD FR-06）
function Library({ locked }: { locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const saved = useLiveQuery(() => listSavedBackdrops(), []);
  const [problem, setProblem] = useState<string | null>(null);
  const refs: BackdropRef[] = [...(saved ?? []).map(refOfBackdrop), ...listedBuiltins().map((b) => refOfBuiltin(b.id)!)];
  return (
    <section className="flex flex-col gap-2.5" aria-label="模板库里的背景图">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3.5">
        {refs.map((r) => {
          const on = ctx.work.backdropId === r.id;
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              disabled={locked}
              className="group flex min-w-0 flex-col gap-1.5 text-left"
              onClick={async () => {
                setProblem(null);
                const out = await pickBackdrop(workId, r.id);
                if (!out.ok) setProblem(out.reason);
              }}
            >
              <span className={`block w-full rounded-lg transition-shadow ${on ? 'shadow-[0_0_0_1.5px_var(--color-ink)]' : 'group-hover:shadow-[0_0_0_1px_var(--color-line-strong),var(--shadow-md)]'}`}>
                <BackdropThumb backdrop={r} />
              </span>
              <span className="truncate text-body font-medium">{r.name}</span>
              <span className="line-clamp-2 text-label text-muted">{paramsLine(r)}</span>
            </button>
          );
        })}
      </div>
      {problem && <p className="text-aux text-warn">{problem}</p>}
    </section>
  );
}

// 背景共创（PRD FR-04）：小间在对话里追问并起草三项总结，确认只能由用户点（PRD 4.2 第 3 条）
function StorySection({ locked }: { locked: boolean }) {
  const { ctx, workId, askAgent, busy } = useWorkspace();
  const { story } = ctx.work;
  const summary = story.summary ?? EMPTY;
  // 每项单独提交，基于数据库里的最新总结，不会覆盖小间刚改的其他项
  const savePart = (k: keyof StorySummary, v: string) =>
    void mutateWork(workId, (c) => editSummary(c.work, { ...(c.work.story.summary ?? EMPTY), [k]: v }));
  const chip = {
    none: <span className="chip">还没有总结</span>,
    draft: <span className="chip chip-warn">草稿，待确认</span>,
    confirmed: <span className="chip chip-ok">已确认</span>,
  }[story.summaryState];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="story-title">
      <div className="flex items-center gap-2">
        <h3 id="story-title" className="text-block font-semibold">
          背景共创
        </h3>
        {chip}
      </div>
      {story.notes.length ? (
        <ul className="flex flex-col gap-1 text-body text-ink-2">
          {story.notes.map((n) => (
            <li key={n.id}>
              <span className="mr-2 text-label text-muted">{KIND_TEXT[n.kind]}</span>
              {n.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-aux text-muted">在左边和小间聊聊这件作品：灵感从哪来、想让顾客感受到什么。说不上来也没关系，可以让小间给几个方向。</p>
      )}
      <label className="flex items-center gap-1.5 text-aux text-muted">
        <input type="checkbox" checked={story.noStory} onChange={(e) => void mutateWork(workId, (c) => setNoStory(c.work, e.target.checked))} />
        暂无明确故事（把重点放在造型和材质上）
      </label>
      <div className="flex flex-col gap-3.5 rounded-xl bg-white px-5 py-[18px]">
        {PARTS.map(([k, label, placeholder]) => (
          <div key={k} className="flex flex-col gap-1.5">
            <label htmlFor={`sum-${k}`} className="text-aux text-muted">
              {label}
            </label>
            <DraftTextarea id={`sum-${k}`} name={k} rows={2} className="field" placeholder={placeholder} disabled={locked} value={summary[k]} onCommit={(v) => savePart(k, v)} />
          </div>
        ))}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!summary.express.trim() || story.summaryState === 'confirmed' || locked}
            onClick={() => void mutateWork(workId, (c) => confirmSummary(c.work))}
          >
            {story.summaryState === 'confirmed' ? '总结已确认' : '确认总结'}
          </button>
          {story.summaryState !== 'none' && (
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy || locked} onClick={() => askAgent('总结不太对，我们再聊聊，重新整理一下')}>
              让小间重新整理
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// 改故事后同步背景风格（AC-04.6）：小间推荐风格之后共创总结改了，提示风格可能要跟着变
function StoryChangedNote({ locked }: { locked: boolean }) {
  const { ctx, workId, askAgent, busy } = useWorkspace();
  if (!styleLagsSummary(ctx.work) || ctx.work.backdropId) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white px-3.5 py-2.5 text-aux text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <span className="min-w-0 flex-1">共创总结改过了，小间之前按旧总结推荐的背景风格可能要跟着变。</span>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy || locked} onClick={() => askAgent('共创总结改了，请按新总结检查并调整背景风格')}>
        让小间按新总结调整
      </button>
      <button type="button" className="btn btn-quiet btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => keepStyleForSummary(c.work))}>
        不用改
      </button>
    </div>
  );
}

// 选定的背景候选：可以沉淀进模板库（起个名字），别的作品就能套用（AC-06.4）
function SaveToLibrary({ backdrop }: { backdrop: Backdrop }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (backdrop.savedAt) return <p className="text-aux text-muted">已沉淀进模板库「{backdrop.name}」</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input className="field !h-7 min-w-0 flex-1 !text-aux" name={`save-${backdrop.id}`} aria-label="背景图的名字" maxLength={20} placeholder="给这张背景起个名字" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="mini-btn shrink-0"
          disabled={!name.trim()}
          onClick={async () => {
            setProblem(null);
            const r = await saveToLibrary(backdrop.id, name);
            if (r.ok) toast(`已沉淀进模板库「${name.trim()}」`, '别的作品可以直接套用');
            else setProblem(r.reason);
          }}
        >
          沉淀进模板库
        </button>
      </div>
      <p className="text-label text-muted">图里不能有饰品，沉淀前请再看一眼</p>
      {problem && <p className="text-label text-warn">{problem}</p>}
    </div>
  );
}

function CandidateCard({ backdrop, locked }: { backdrop: Backdrop; locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const [problem, setProblem] = useState<string | null>(null);
  const full = useBlobUrl(backdrop.blobId);
  const ref = refOfBackdrop(backdrop);
  const on = ctx.work.backdropId === backdrop.id;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <a href={full ?? undefined} target="_blank" rel="noreferrer" className={`block cursor-zoom-in rounded-lg ${on ? 'shadow-[0_0_0_1.5px_var(--color-ink)]' : ''}`} aria-label={`查看背景 ${backdrop.slot + 1} 大图`}>
        <BackdropThumb backdrop={ref} />
      </a>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="mini-btn"
          aria-pressed={on}
          disabled={locked || on}
          onClick={async () => {
            setProblem(null);
            const r = await pickBackdrop(workId, backdrop.id);
            if (!r.ok) setProblem(r.reason);
          }}
        >
          {on ? '已选定' : '用这张'}
        </button>
        <span className="text-label text-muted">背景 {backdrop.slot + 1}</span>
      </div>
      {problem && <p className="text-label text-warn">{problem}</p>}
      {on && <SaveToLibrary backdrop={backdrop} />}
    </div>
  );
}

// 这一轮的两张背景（AC-08.0）：生成中、失败可补齐、出来后选一张。图里不能有饰品，代码判断不了，由用户把关（AC-06.2）
function Candidates({ locked }: { locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const round = ctx.work.backdropRound;
  if (!round) return null;
  const cands = backdropCandidates(ctx.backdrops, workId, round);
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="backdrop-cands">
      <div className="flex items-baseline gap-2">
        <h3 id="backdrop-cands" className="text-block font-semibold">
          第 {round} 轮背景
        </h3>
        {cands.length > 0 && <span className="text-aux text-muted">选一张。图里不能有饰品，请你把关</span>}
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,200px))] gap-5">
        {slotsOf('backdrop').map((slot) => {
          const b = cands.find((c) => c.slot === slot);
          if (b) return <CandidateCard key={slot} backdrop={b} locked={locked} />;
          const st = slotState(ctx.tasks, workId, 'backdrop', round, slot);
          const last = ctx.tasks.filter((t) => t.kind === 'backdrop' && t.round === round && t.slot === slot).sort((a, b2) => a.attempt - b2.attempt).at(-1);
          if (st === 'failed') return <FailedBackdrop key={slot} round={round} slot={slot} error={last?.error} />;
          return (
            <RefineFrame
              key={slot}
              status={last?.status === 'queued' ? 'queued' : 'generating'}
              aspectRatio="3 / 4"
              width={600}
              radius={8}
              labels={{ queued: '正在提交…', generating: '生成中，通常要一两分钟' }}
              ariaLabel={`背景 ${slot + 1}：${last?.status === 'queued' ? '正在提交' : '生成中'}`}
            />
          );
        })}
      </div>
    </section>
  );
}

function FailedBackdrop({ round, slot, error }: { round: number; slot: number; error?: string }) {
  const { workId } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <RefineFrame
        status="error"
        aspectRatio="3 / 4"
        width={600}
        radius={8}
        ariaLabel={`背景 ${slot + 1}：没有生成出来`}
        retryLabel={pending ? '提交中…' : '补齐这一张'}
        retryDisabled={pending}
        onRetry={async () => {
          setPending(true);
          const r = await retrySlot(workId, 'backdrop', round, slot);
          setPending(false);
          setReason(r.ok ? null : r.reasons.join('；'));
        }}
      />
      <p className="text-aux text-bad">背景 {slot + 1} 没有生成出来：{error ?? '原因未知'}</p>
      {reason && <p className="text-aux text-warn">{reason}</p>}
    </div>
  );
}

// 背景（PRD FR-04、FR-06，技术写法 13.4）：两套流程都能二选一——用模板库里的，或自己生成（共创 → 背景风格 → 批准 → 两张选一张）
export function BackdropStep() {
  const { ctx } = useWorkspace();
  const { work, busy } = ctx;
  const picked = !!work.backdropId;
  const done = backdropDone(work, ctx.backdrop);
  // 背景生成中锁背景风格和背景提示词；合成生成中背景图锁进了快照，不能换
  const lockStyle = busy.backdrop;
  const lockPick = busy.scene || busy.backdrop;
  const st = backdropApprovalStatus(ctx);
  const conflicts = backdropConflicts(backdropStyleOf(work));
  const fixed = picked && ctx.backdrop ? ctx.backdrop.params : null;

  const chip = done ? (
    <span className="chip chip-ok">已选定</span>
  ) : !work.backdropMode ? (
    <span className="chip">待选择做法</span>
  ) : (
    <span className="chip chip-warn">{work.backdropMode === 'library' ? '待选一张' : '待生成'}</span>
  );

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <StepHead step="backdrop">{chip}</StepHead>
      {busy.scene && <p className="-mt-3 text-aux text-muted">正在合成这一轮候选，背景暂时不能换。</p>}
      <ModeSwitch locked={lockPick} />
      {!work.backdropMode && <p className="-mt-2 text-aux text-muted">用模板库里的背景，直接放进同一个取景；或者和小间聊聊作品，自己生成一张新的。</p>}
      <CurrentBackdrop locked={lockPick} />
      {work.backdropMode === 'library' && <Library locked={lockPick} />}
      {work.backdropMode === 'generate' && (
        <>
          <StorySection locked={busy.backdrop || busy.scene} />
          <StoryChangedNote locked={lockStyle} />
          <section className="flex flex-col gap-1" aria-labelledby="backdrop-style">
            <div className="flex items-baseline gap-2">
              <h3 id="backdrop-style" className="text-block font-semibold">
                背景风格
              </h3>
              {picked && <span className="text-aux text-muted">以选定的背景图为准；想改就重新设计背景</span>}
              {st.kind === 'stale' && !picked && <span className="text-aux text-warn">批准后改了：{st.changed.join('、')}</span>}
            </div>
            <div className="rounded-xl bg-white px-5 py-2">
              {BACKDROP_KEYS.map((k) => (
                <StyleRow key={k} k={k} locked={lockStyle} fixed={picked ? (fixed?.[k] ?? '') : undefined} />
              ))}
            </div>
            {conflicts.length > 0 && !picked && (
              <ul className="mt-1 list-disc pl-5 text-aux text-warn">
                {conflicts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </section>
          {!picked && (
            <>
              <section className="flex flex-col gap-2.5 rounded-xl bg-white px-5 py-[18px]">
                <h3 className="text-block font-semibold">背景方案</h3>
                <BackdropPlanSummary />
              </section>
              <PromptSection kind="backdrop" locked={lockStyle} />
              <section className="flex flex-col gap-2.5">
                <BlockerList kind="backdrop" />
                <ApproveButton kind="backdrop" />
              </section>
            </>
          )}
          <Candidates locked={lockPick} />
        </>
      )}
      <NextStep step="backdrop" />
    </div>
  );
}
