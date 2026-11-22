'use client';

import { RATIOS, RATIO_NOTES, type Ratio } from '@/config/ratios';
import { SCENE_KEYS } from '@/config/style';
import { mutateWork } from '@/client/work-store';
import { sceneApprovalStatus } from '@/domain/approval';
import { sceneConflicts } from '@/domain/conflicts';
import { sceneStyleOf } from '@/domain/snapshot';
import { cancelRevision, setRatio } from '@/domain/work';
import { ApproveButton } from '@/components/plan/approve-button';
import { BlockerList, PlanSummary } from '@/components/plan/plan-summary';
import { PromptSection } from '@/components/plan/prompt-section';
import { StyleRow } from '@/components/plan/style-row';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';
import JellyRadio from '@/components/bits/JellyRadio/JellyRadio';

// 正在从某张结果修改（AC-09.4）：说明来源，可以取消、恢复修改前的方案。参考图仍是背景图和三视图（v0.6 取消房间参考）
function RevisionNote() {
  const { ctx, workId } = useWorkspace();
  const rev = ctx.work.revision;
  if (!rev) return null;
  const from = ctx.results.find((r) => r.id === rev.fromResultId);
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white px-3.5 py-2.5 text-aux text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <span className="min-w-0 flex-1">
        正在修改{from ? `第 ${from.round} 轮候选 ${from.slot + 1}` : '一张旧结果'}
        {rev.reasons.length ? `（不满意：${rev.reasons.join('、')}）` : ''}，已恢复那一版的方案。改好后重新批准，原结果会保留；问题出在背景时，回「背景」换一张或重新生成。
      </span>
      <button type="button" className="btn btn-quiet btn-sm" disabled={ctx.busy.scene} onClick={() => void mutateWork(workId, (c) => cancelRevision(c.work))}>
        取消修改
      </button>
    </div>
  );
}

// 摆放（PRD FR-05、FR-07、FR-08）：摆放卡、比例、合成提示词；批准绑定快照，改动后旧批准失效
export function PlacementStep() {
  const { ctx, workId } = useWorkspace();
  const { work } = ctx;
  const locked = ctx.busy.scene;
  const conflicts = sceneConflicts(sceneStyleOf(work));
  const ap = sceneApprovalStatus(ctx);

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <StepHead step="placement">
        {ap.kind === 'valid' && <span className="chip chip-ok">第 {ctx.approval!.version} 版已批准</span>}
        {ap.kind === 'stale' && <span className="chip chip-warn">批准已失效</span>}
      </StepHead>
      {ap.kind === 'stale' && <p className="-mt-3 text-aux text-warn">批准后改了：{ap.changed.join('、')}。需要重新批准才能生成。</p>}
      {locked && <p className="-mt-3 text-aux text-muted">正在生成这一轮，方案锁定中。</p>}
      <RevisionNote />

      <section className="flex flex-col gap-1" aria-labelledby="scene-card">
        <div className="flex items-baseline gap-2">
          <h3 id="scene-card" className="text-block font-semibold">
            摆放卡
          </h3>
          <span className="text-aux text-muted">支架、挂钩、首饰托盘写在摆放里；背景里没有的，合成时加上</span>
        </div>
        <div className="rounded-xl bg-white px-5 py-2">
          {SCENE_KEYS.map((k) => (
            <StyleRow key={k} k={k} locked={locked} />
          ))}
        </div>
        {conflicts.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-aux text-warn">
            {conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <h3 className="text-block font-semibold">比例</h3>
        <JellyRadio
          ariaLabel="主图比例"
          items={[...RATIOS]}
          value={work.ratio}
          disabled={locked}
          className="-mx-3"
          onChange={(r) => void mutateWork(workId, (c) => setRatio(c.work, r as Ratio))}
        />
        <span className="text-aux text-muted">{RATIO_NOTES[work.ratio]}</span>
      </section>

      <section className="flex flex-col gap-2.5 rounded-xl bg-white px-5 py-[18px]">
        <h3 className="text-block font-semibold">合成方案</h3>
        <PlanSummary />
      </section>

      <PromptSection kind="scene" locked={locked} />

      <section className="flex flex-col gap-2.5">
        <BlockerList kind="scene" />
        <ApproveButton kind="scene" />
      </section>
    </div>
  );
}
