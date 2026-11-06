'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { use, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'react-dom';
import { BUILTIN_SCENES } from '@/config/scenes';
import { NO_PROPS, STYLE_LABELS, toneColors } from '@/config/style';
import { createWork } from '@/client/create-work';
import { setFirstMessage } from '@/client/first-message';
import { useLibrary } from '@/client/hooks';
import { deleteScene, listScenes } from '@/data/repo';
import type { Scene, SceneParams } from '@/domain/types';
import { useConfirm } from '@/components/ui/dialog';
import { fmtTime } from '@/components/ui/format';
import { Icon } from '@/components/ui/icon';
import { PageFrame, PageLoading } from './page-frame';
import WarmTooltip from '@/components/bits/WarmTooltip/WarmTooltip';
import { useToast } from '@/components/ui/toast';

const PARAM_KEYS = ['tone', 'background', 'light', 'placement', 'props', 'banned', 'composition'] as const satisfies readonly (keyof SceneParams)[];
const NEUTRAL = ['#eeeeee', '#dddddd', '#cccccc'];

const shown = (k: keyof SceneParams, v: string) => v.trim() || (k === 'props' ? NO_PROPS : '—');

interface CardProps {
  name: string;
  params: SceneParams;
  colors: readonly string[];
  used: number;
  saved?: Scene;
  starting: boolean;
  onStart: () => void;
}

function SceneCard({ name, params, colors, used, saved, starting, onStart }: CardProps) {
  const confirm = useConfirm();
  const toast = useToast();
  return (
    <article className="flex flex-col overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_var(--color-line)]">
      <div className="flex h-10" aria-hidden="true">
        {colors.map((c, i) => (
          <span key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3.5 text-aux">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-block font-semibold">{name}</h3>
          {saved && <span className="chip">v{saved.version}</span>}
          {saved && (
            <WarmTooltip content="删除布景">
              <button
                type="button"
                className="icon-btn -my-1 -mr-1.5 ml-auto"
                aria-label={`删除布景「${name}」`}
                onClick={async () => {
                  const ok = await confirm({
                    title: `删除布景「${name}」？`,
                    body: '已经用过这套布景的作品不受影响，它们的风格卡会保留当时的内容。',
                    ok: '删除',
                    danger: true,
                  });
                  if (!ok) return;
                  await deleteScene(saved.id);
                  toast(`已删除布景「${name}」`);
                }}
              >
                <Icon name="trash" />
              </button>
            </WarmTooltip>
          )}
        </div>
        <dl className="grid grid-cols-[56px_1fr] gap-x-2.5 gap-y-[3px] text-ink-2">
          {PARAM_KEYS.map((k) => (
            <div key={k} className="contents">
              <dt className="text-muted">{STYLE_LABELS[k]}</dt>
              <dd>{shown(k, params[k])}</dd>
            </div>
          ))}
        </dl>
        {saved && saved.history.length > 0 && (
          <details className="text-muted">
            <summary className="cursor-pointer select-none hover:text-ink">历史版本（{saved.history.length}）</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {[...saved.history].reverse().map((h) => (
                <li key={h.version}>
                  v{h.version} · {fmtTime(h.at)} · {shown('background', h.params.background)} · {shown('light', h.params.light)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <p className="min-w-0 flex-1 text-muted">
            {used ? `${used} 件作品正在使用` : '暂未被使用'}
            {saved ? ` · 更新于 ${fmtTime(saved.updatedAt)}` : ''}
          </p>
          <button type="button" className="btn btn-outline btn-sm" disabled={starting} onClick={onStart}>
            用这套开始
          </button>
        </div>
      </div>
    </article>
  );
}

// 摄影布景（PRD FR-06）：内置模版和自己存的布景；布景是方案参数，不是某张结果图
export function ScenesPage() {
  use(browser('布景存在浏览器的本地数据库里'));
  const router = useRouter();
  const lib = useLibrary();
  const saved = useLiveQuery(() => listScenes(), []);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 离开的页面会被 Activity 保留（next.config 开了 cacheComponents）：开始了一件作品再回到布景页，
  // 「用这套开始」要能接着点，不留上一件的「开始中」（同首页 BC-010）
  const startedRef = useRef(false);
  useLayoutEffect(
    () => () => {
      if (!startedRef.current) return;
      startedRef.current = false;
      setStarting(false);
    },
    [],
  );
  if (!lib || !saved) return <PageLoading />;

  const usedBy = (id: string) => lib.works.filter((c) => c.work.sceneId === id).length;
  const start = async (id: string) => {
    if (starting) return;
    setStarting(true);
    setProblem(null);
    try {
      const { work, scene } = await createWork(id);
      setFirstMessage(work.id, `我想用「${scene!.name}」这套布景`, []);
      startedRef.current = true;
      router.push(`/works/${work.id}`);
    } catch (e) {
      setProblem(`没能新建作品：${e instanceof Error ? e.message : String(e)}`);
      setStarting(false);
    }
  };

  return (
    <PageFrame title="摄影布景" intro="背景、色调、光线、道具和构图的固定组合，换一件作品也能直接套用。">
      {problem && (
        <p role="alert" className="-mt-3 mb-4 text-aux text-bad">
          {problem}
        </p>
      )}
      {saved.length > 0 && (
        <section className="mb-10 flex flex-col gap-3.5">
          <h2 className="text-block font-semibold">我存的布景</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
            {saved.map((s) => (
              <SceneCard
                key={s.id}
                name={s.name}
                params={s.params}
                colors={toneColors(s.params.tone) ?? NEUTRAL}
                used={usedBy(s.id)}
                saved={s}
                starting={starting}
                onStart={() => void start(s.id)}
              />
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-block font-semibold">布景模版</h2>
          {saved.length === 0 && <span className="text-aux text-muted">满意的方案也可以存成自己的布景，会列在模版上面</span>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {BUILTIN_SCENES.map((s) => (
            <SceneCard
              key={s.id}
              name={s.name}
              params={s.params}
              colors={s.colors}
              used={usedBy(s.id)}
              starting={starting}
              onStart={() => void start(s.id)}
            />
          ))}
        </div>
      </section>
    </PageFrame>
  );
}
