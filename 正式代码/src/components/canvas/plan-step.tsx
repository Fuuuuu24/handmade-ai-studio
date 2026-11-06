'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { RATIOS, RATIO_NOTES } from '@/config/ratios';
import { BUILTIN_SCENES } from '@/config/scenes';
import { NO_PROPS, STYLE_KEYS, STYLE_LABELS, STYLE_OPTIONS, TONE_OPTIONS, type StyleKey } from '@/config/style';
import { mutateWork } from '@/client/work-store';
import { getShopStyle, listScenes } from '@/data/repo';
import { approvalStatus, promptStatus, promptWriteBlocker } from '@/domain/approval';
import { styleConflicts } from '@/domain/conflicts';
import { styleValuesOf } from '@/domain/snapshot';
import type { StyleSource } from '@/domain/types';
import { applyScene, applyShopPrefs, cancelRevision, editPrompt, keepStyleForSummary, markPromptChecked, revertPrompt, setRatio, setStyle, styleLagsSummary } from '@/domain/work';
import { SceneSaveForm, ShopStyleForm } from '@/components/plan/library-forms';
import { PlanSummary } from '@/components/plan/plan-summary';
import { Modal } from '@/components/ui/dialog';
import { ApproveButton } from '@/components/plan/approve-button';
import { DraftInput, DraftTextarea } from '@/components/ui/draft-field';
import { BlockerList } from '@/components/plan/plan-summary';
import { useWorkspace } from '@/components/workspace/context';
import { StepHead } from './canvas';
import JellyRadio from '@/components/bits/JellyRadio/JellyRadio';
import type { Ratio } from '@/config/ratios';
import GlideSelect from '@/components/bits/GlideSelect/GlideSelect';

const SOURCE_TAG: Partial<Record<StyleSource, [string, string]>> = {
  recommend: ['小间推荐', 'text-accent'],
  said: ['你说的', 'text-muted'],
  scene: ['布景', 'text-muted'],
  shop: ['我的风格', 'text-muted'],
};

const toneSwatch = (name: string) => TONE_OPTIONS.find((t) => t.name === name)?.colors;

// 有常用选项的项：选项胶囊＋行末「自己描述」小输入框，输入框只显示选项以外的说法（v2 第三次改版已确认）；
// 道具、禁止出现、表达没有选项，用整行输入
function StyleRow({ k, locked }: { k: StyleKey; locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const v = ctx.work.style[k];
  const options = STYLE_OPTIONS[k] ?? [];
  const tag = v.value ? SOURCE_TAG[v.source] : undefined;
  const custom = v.value && !options.includes(v.value) ? v.value : '';
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
        {options.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {options.map((o) => {
              const swatch = k === 'tone' ? toneSwatch(o) : undefined;
              return (
                <button key={o} type="button" className="choice gap-2" aria-pressed={v.value === o} disabled={locked} onClick={() => set(o)}>
                  {swatch && (
                    <span className="inline-flex overflow-hidden rounded-sm" aria-hidden="true">
                      {swatch.map((c) => (
                        <i key={c} className="h-3 w-2" style={{ background: c }} />
                      ))}
                    </span>
                  )}
                  {o}
                </button>
              );
            })}
            <DraftInput
              id={`style-${k}`}
              name={k}
              className={`h-7 min-w-28 max-w-full rounded-full bg-white px-3 text-body [field-sizing:content] placeholder:text-placeholder focus:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-ring)] focus:outline-none disabled:bg-canvas ${
                custom ? 'shadow-[inset_0_0_0_1.5px_var(--color-ink)]' : 'shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-line-hover)]'
              }`}
              disabled={locked}
              placeholder="自己描述"
              title="选项里没有的说法写在这里"
              value={custom}
              onCommit={(text) => text.trim() !== custom && set(text)}
            />
          </div>
        ) : (
          <DraftInput
            id={`style-${k}`}
            name={k}
            className="field"
            disabled={locked}
            placeholder={k === 'props' ? NO_PROPS : k === 'banned' ? '比如：花、玻璃器皿' : '用自己的话描述'}
            value={v.value}
            onCommit={(text) => text.trim() !== v.value && set(text)}
          />
        )}
        {v.reason && v.source === 'recommend' && <p className="text-label text-muted">理由：{v.reason}</p>}
        {v.quote && v.source === 'said' && <p className="text-label text-muted">原话：「{v.quote}」</p>}
      </div>
    </div>
  );
}

function PromptSection({ locked }: { locked: boolean }) {
  const { ctx, workId, askAgent, busy } = useWorkspace();
  const prompt = ctx.work.prompt;
  const ps = promptStatus(ctx.work, ctx.basis);
  // 核心信息的建议没处理完，小间写不了也改不了提示词（UX-02）：说明原因，「让小间写」先灰掉，不白发一次请求
  const wait = promptWriteBlocker(ctx.work);

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
      {wait && (
        <p className="text-aux text-ink-2">
          {wait.text}，处理完小间才能{prompt?.text.trim() ? '改' : '写'}提示词。
        </p>
      )}
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
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || locked || !!wait} onClick={() => askAgent(ps.kind === 'missing' ? '请按现在的方案写提示词' : '方案改了，请按现在的方案重写提示词')}>
            {ps.kind === 'missing' ? '让小间写' : '让小间重写'}
          </button>
        )}
        {/* 小间不可用时也能继续（AC-11.6）：自己对照改动，确认提示词仍然适用 */}
        {ps.kind === 'stale' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => markPromptChecked(c.work, c.basis))}>
            我核对过，仍然适用
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

// 正在从某张结果修改（AC-09.4）：说明来源，可以取消、恢复修改前的方案
function RevisionNote() {
  const { ctx, workId } = useWorkspace();
  const rev = ctx.work.revision;
  if (!rev) return null;
  const from = ctx.results.find((r) => r.id === rev.fromResultId);
  return (
    <div className="-mt-2 flex items-center gap-3 rounded-lg bg-white px-3.5 py-2.5 text-aux text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <span className="min-w-0 flex-1">
        正在修改{from ? `第 ${from.round} 轮候选 ${from.slot + 1}` : '一张旧结果'}{rev.reasons.length ? `（不满意：${rev.reasons.join('、')}）` : ''}，已恢复那一版的方案。生成时会带上这张图，沿用它的房间和机位；改好后重新批准，原结果会保留。
      </span>
      <button type="button" className="btn btn-quiet btn-sm" disabled={ctx.isGenerating} onClick={() => void mutateWork(workId, (c) => cancelRevision(c.work))}>
        取消修改
      </button>
    </div>
  );
}

// 改故事后同步风格（AC-04.6）：小间推荐风格之后共创总结改了，提示风格可能要跟着变
function StoryChangedNote({ locked }: { locked: boolean }) {
  const { ctx, workId, askAgent, busy } = useWorkspace();
  if (!styleLagsSummary(ctx.work)) return null;
  return (
    <div className="-mt-2 flex items-center gap-3 rounded-lg bg-white px-3.5 py-2.5 text-aux text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <span className="min-w-0 flex-1">共创总结改过了，小间之前按旧总结推荐的风格可能要跟着变。</span>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy || locked} onClick={() => askAgent('共创总结改了，请按新总结检查并调整风格')}>
        让小间按新总结调整
      </button>
      <button type="button" className="btn btn-quiet btn-sm" disabled={locked} onClick={() => void mutateWork(workId, (c) => keepStyleForSummary(c.work))}>
        不用改
      </button>
    </div>
  );
}

// 摄影布景：内置模版、自己存的布景、我的风格都可以一键套用（FR-06）；满意的方案可以存成布景、写进我的风格
function SceneSection({ locked }: { locked: boolean }) {
  const { ctx, workId } = useWorkspace();
  const saved = useLiveQuery(() => listScenes(), []) ?? [];
  const shop = useLiveQuery(() => getShopStyle(), []);
  const [dialog, setDialog] = useState<'scene' | 'shop' | null>(null);
  const { work } = ctx;
  const shopKeys = shop ? STYLE_KEYS.filter((k) => shop.prefs[k]?.trim()) : [];
  const savedCurrent = saved.find((s) => s.id === work.sceneId);
  const chip = (id: string, name: string, colors: readonly string[] | undefined, title: string, params: Parameters<typeof applyScene>[2]) => (
    <button
      key={id}
      type="button"
      className="choice gap-2"
      aria-pressed={work.sceneId === id}
      disabled={locked}
      title={title}
      onClick={() => void mutateWork(workId, (c) => applyScene(c.work, id, params))}
    >
      {colors && (
        <span className="inline-flex overflow-hidden rounded-sm" aria-hidden="true">
          {colors.map((c) => (
            <i key={c} className="h-3 w-2" style={{ background: c }} />
          ))}
        </span>
      )}
      {name}
    </button>
  );
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-block font-semibold">摄影布景</h3>
        <span className="ml-auto flex gap-1">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('scene')}>
            存为布景
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('shop')}>
            更新为我的风格
          </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {shopKeys.length > 0 && (
          <button
            type="button"
            className="choice"
            disabled={locked}
            title={shopKeys.map((k) => `${STYLE_LABELS[k]}：${shop!.prefs[k]}`).join('；')}
            onClick={() => void mutateWork(workId, (c) => applyShopPrefs(c.work, shop!.prefs))}
          >
            套用我的风格
          </button>
        )}
        {BUILTIN_SCENES.map((s) => chip(s.id, s.name, s.colors, s.desc, s.params))}
        {/* 自己存的布景可能越存越多，收进下拉（React Bits Glide Select）；内置模版带色块，保留胶囊 */}
        {saved.length > 0 && (
          <GlideSelect
            ariaLabel="我存的布景"
            size="sm"
            placeholder="我存的布景"
            menuWidth={200}
            options={saved.map((s) => ({ value: s.id, label: s.name, tag: `第 ${s.version} 版` }))}
            value={savedCurrent?.id ?? ''}
            disabled={locked}
            onChange={(id) => {
              const s = saved.find((x) => x.id === id);
              if (s) void mutateWork(workId, (c) => applyScene(c.work, s.id, s.params));
            }}
          />
        )}
      </div>
      <Modal open={dialog === 'scene'} onClose={() => setDialog(null)} title="存为摄影布景" sub="以后别的作品可以直接套用">
        {dialog === 'scene' && (
          <SceneSaveForm defaultName={savedCurrent?.name ?? ''} updateSceneId={savedCurrent?.id} onSaved={() => setDialog(null)} onCancel={() => setDialog(null)} />
        )}
      </Modal>
      <Modal open={dialog === 'shop'} onClose={() => setDialog(null)} title="更新为我的风格" sub="勾选要写进店铺长期风格的几项">
        {dialog === 'shop' && <ShopStyleForm reason="" onSaved={() => setDialog(null)} onCancel={() => setDialog(null)} />}
      </Modal>
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
      <RevisionNote />
      <StoryChangedNote locked={locked} />

      <SceneSection locked={locked} />

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
        <h3 className="text-block font-semibold">可读方案</h3>
        <PlanSummary />
      </section>

      <PromptSection locked={locked} />

      <section className="flex flex-col gap-2.5">
        <BlockerList />
        <ApproveButton />
      </section>
    </div>
  );
}
