'use client';

import { mutateWork } from '@/client/work-store';
import type { StorySummary } from '@/domain/types';
import { confirmSummary, editSummary, setNoStory } from '@/domain/work';
import { DraftTextarea } from '@/components/ui/draft-field';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';

const PARTS: [keyof StorySummary, string, string][] = [
  ['express', '作品想表达什么', '比如：雨后石阶上的一小片青苔，安静、湿润的绿'],
  ['feel', '希望顾客感受到什么', '比如：安静、自然，想凑近看细节'],
  ['avoid', '明确避免什么', '比如：太亮太花，道具抢了耳环'],
];

const KIND_TEXT = { inspiration: '灵感', theme: '主题', emotion: '情绪', other: '其他' } as const;
const EMPTY: StorySummary = { express: '', feel: '', avoid: '' };

// 共创（PRD FR-04）：小间在对话里追问并起草三项总结，确认只能由用户点（PRD 4.2 第 3 条）
export function StoryStep() {
  const { ctx, workId, askAgent, busy, setViewing } = useWorkspace();
  const { story } = ctx.work;
  const locked = ctx.isGenerating; // 总结锁进了批准快照，生成中不能改
  const summary = story.summary ?? EMPTY;
  // 每项单独提交，基于数据库里的最新总结，不会覆盖小间刚改的其他项
  const savePart = (k: keyof StorySummary, v: string) =>
    void mutateWork(workId, (c) => editSummary(c.work, { ...(c.work.story.summary ?? EMPTY), [k]: v }));
  const stateChip = {
    none: <span className="chip">还没有总结</span>,
    draft: <span className="chip chip-warn">草稿，待确认</span>,
    confirmed: <span className="chip chip-ok">已确认</span>,
  }[story.summaryState];

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <StepHead step="story">{stateChip}</StepHead>
      {locked && <p className="-mt-3 text-aux text-muted">正在生成这一轮，共创总结暂时锁定。</p>}

      <section className="flex flex-col gap-2">
        <h3 className="text-block font-semibold">共创记录</h3>
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
      </section>

      <section className="flex flex-col gap-3.5 rounded-xl bg-white px-5 py-[18px]">
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
            onClick={async () => {
              await mutateWork(workId, (c) => confirmSummary(c.work));
              setViewing(null);
            }}
          >
            {story.summaryState === 'confirmed' ? '总结已确认' : '确认总结'}
          </button>
          {story.summaryState !== 'none' && (
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy || locked} onClick={() => askAgent('总结不太对，我们再聊聊，重新整理一下')}>
              让小间重新整理
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
