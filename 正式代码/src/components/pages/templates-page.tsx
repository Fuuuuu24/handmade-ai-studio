'use client';

import { useRouter } from 'next/navigation';
import { use, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'react-dom';
import { listedBuiltins } from '@/config/backdrops';
import { BACKDROP_KEYS, NO_PROPS, STYLE_SHORT } from '@/config/style';
import { deleteFromLibrary, renameBackdrop } from '@/client/backdrops';
import { createWork } from '@/client/create-work';
import { setFirstMessage } from '@/client/first-message';
import { useLibrary } from '@/client/hooks';
import { refOfBackdrop, refOfBuiltin, usedBy } from '@/domain/backdrops';
import type { Backdrop, BackdropRef } from '@/domain/types';
import { BackdropThumb } from '@/components/ui/backdrop-thumb';
import { useConfirm } from '@/components/ui/dialog';
import { DraftInput } from '@/components/ui/draft-field';
import { fmtTime } from '@/components/ui/format';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { PageFrame, PageLoading } from './page-frame';
import WarmTooltip from '@/components/bits/WarmTooltip/WarmTooltip';

interface CardProps {
  backdrop: BackdropRef;
  saved?: Backdrop;
  source: string;
  used: number;
  starting: boolean;
  onStart: () => void;
}

// 一张背景图（AC-06.1）：缩略图、方案参数（内置模板暂无参数，不显示）、来源、沉淀时间、被几件作品用过
function TemplateCard({ backdrop, saved, source, used, starting, onStart }: CardProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <article className="flex flex-col gap-2.5">
      <BackdropThumb backdrop={backdrop} />
      <div className="flex flex-col gap-1.5 px-0.5 text-aux">
        <div className="flex items-center gap-1">
          {saved ? (
            <DraftInput
              aria-label="背景图的名字"
              name={`name-${saved.id}`}
              maxLength={20}
              className="-ml-1.5 h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-body font-medium text-ink hover:bg-soft focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-ring)] focus:outline-none"
              value={saved.name}
              onCommit={async (v) => {
                setProblem(null);
                if (!v.trim()) return;
                const r = await renameBackdrop(saved.id, v);
                if (!r.ok) setProblem(r.reason);
              }}
            />
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-body font-medium">{backdrop.name}</h3>
          )}
          {saved && (
            <WarmTooltip content="从模板库删除">
              <button
                type="button"
                className="icon-btn -mr-1.5"
                aria-label={`删除背景图「${saved.name}」`}
                onClick={async () => {
                  const ok = await confirm({
                    title: `从模板库删除「${saved.name}」？`,
                    body: '删除后不能再被新作品选用；已经用了它的作品照常可以合成，历史结果里仍能看到。',
                    ok: '删除',
                    danger: true,
                  });
                  if (!ok) return;
                  await deleteFromLibrary(saved.id);
                  toast(`已从模板库删除「${saved.name}」`);
                }}
              >
                <Icon name="trash" />
              </button>
            </WarmTooltip>
          )}
        </div>
        {backdrop.params ? (
          <dl className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5 text-ink-2">
            {BACKDROP_KEYS.filter((k) => backdrop.params![k] || k === 'props').map((k) => (
              <div key={k} className="contents">
                <dt className="text-muted">{STYLE_SHORT[k]}</dt>
                <dd>{backdrop.params![k] || NO_PROPS}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted">示意模板，无参数</p>
        )}
        <p className="text-muted">
          {source}
          {saved?.savedAt ? ` · 沉淀于 ${fmtTime(saved.savedAt)}` : ''} · {used ? `${used} 件作品用过` : '还没被用过'}
        </p>
        {problem && <p className="text-warn">{problem}</p>}
        <button type="button" className="btn btn-outline btn-sm mt-0.5 self-start" disabled={starting} onClick={onStart}>
          套用
        </button>
      </div>
    </article>
  );
}

// 模板库（PRD FR-06）：内置模板和用户沉淀的背景图，取代 v0.5 的「我的风格」「摄影布景」。套用就新建一件作品（流程二）
export function TemplatesPage() {
  use(browser('模板库存在浏览器的本地数据库里'));
  const router = useRouter();
  const lib = useLibrary();
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 离开的页面会被 Activity 保留（next.config 开了 cacheComponents）：套用了一张再回来，「套用」要能接着点（同首页 BC-010）
  const startedRef = useRef(false);
  useLayoutEffect(
    () => () => {
      if (!startedRef.current) return;
      startedRef.current = false;
      setStarting(false);
    },
    [],
  );
  if (!lib) return <PageLoading />;

  const works = lib.works.map((c) => c.work);
  const nameOf = new Map(works.map((w) => [w.id, w.name]));
  const saved = [...lib.backdrops.values()].filter((b) => b.savedAt != null && b.deletedAt == null).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  const start = async (ref: BackdropRef) => {
    if (starting) return;
    setStarting(true);
    setProblem(null);
    try {
      const { work } = await createWork(ref.id);
      setFirstMessage(work.id, `我想套用「${ref.name}」这张背景`, []);
      startedRef.current = true;
      router.push(`/works/${work.id}`);
    } catch (e) {
      setProblem(`没能新建作品：${e instanceof Error ? e.message : String(e)}`);
      setStarting(false);
    }
  };
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-x-4 gap-y-7';

  return (
    <PageFrame title="模板库" intro="内置模板和你沉淀的背景图。套用后，新作品会放进同一个取景，店里的图看起来是一套。">
      {problem && (
        <p role="alert" className="-mt-3 mb-4 text-aux text-bad">
          {problem}
        </p>
      )}
      {saved.length > 0 && (
        <section className="mb-10 flex flex-col gap-3.5">
          <h2 className="text-block font-semibold">我沉淀的</h2>
          <div className={grid}>
            {saved.map((b) => {
              const ref = refOfBackdrop(b);
              const from = nameOf.get(b.workId);
              return (
                <TemplateCard
                  key={b.id}
                  backdrop={ref}
                  saved={b}
                  source={from ? `出自「${from}」` : '出自一件已删除的作品'}
                  used={usedBy(b.id, works, lib.approvals)}
                  starting={starting}
                  onStart={() => void start(ref)}
                />
              );
            })}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-block font-semibold">内置模板</h2>
          {saved.length === 0 && <span className="text-aux text-muted">自己生成的背景选定后可以沉淀进来，会列在内置模板上面</span>}
        </div>
        <div className={grid}>
          {listedBuiltins().map((b) => {
            const ref = refOfBuiltin(b.id)!;
            return <TemplateCard key={b.id} backdrop={ref} source="内置" used={usedBy(b.id, works, lib.approvals)} starting={starting} onStart={() => void start(ref)} />;
          })}
        </div>
      </section>
    </PageFrame>
  );
}
