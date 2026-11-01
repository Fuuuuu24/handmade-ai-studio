'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { NO_PROPS, STYLE_KEYS, STYLE_LABELS, type StyleKey } from '@/config/style';
import { saveSceneFromWork, saveShopFromWork } from '@/client/library';
import { getScene, getShopStyle } from '@/data/repo';
import { sceneChanges, sceneParamsOf, sceneSaveProblem, shopDiff, shopItemsOf } from '@/domain/library';
import { useWorkspace } from '@/components/workspace/context';

/* 存为布景、更新我的风格：方案页弹窗和小间的提议卡片共用。写入只在用户点按钮时发生（PRD 4.2 第 2 条）。 */

const SCENE_ROWS = ['tone', 'background', 'light', 'placement', 'props', 'banned', 'composition'] as const;

export function SceneSaveForm({
  defaultName,
  updateSceneId,
  onSaved,
  onCancel,
  cancelText = '取消',
}: {
  defaultName: string;
  updateSceneId?: string;
  onSaved: () => void;
  onCancel: () => void;
  cancelText?: string;
}) {
  const { ctx, workId } = useWorkspace();
  const [name, setName] = useState(defaultName);
  const [mode, setMode] = useState<'new' | 'update'>(updateSceneId ? 'update' : 'new');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const existing = useLiveQuery(() => (updateSceneId ? getScene(updateSceneId) : undefined), [updateSceneId]);
  const params = sceneParamsOf(ctx.work);
  const blocked = sceneSaveProblem(params, name);
  const changes = existing ? sceneChanges(existing.params, params) : [];

  return (
    <div className="flex flex-col gap-3">
      {existing && (
        <div className="segmented self-start" role="group" aria-label="存法">
          <button type="button" aria-pressed={mode === 'update'} onClick={() => setMode('update')}>
            更新「{existing.name}」
          </button>
          <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
            存成新布景
          </button>
        </div>
      )}
      <label className="flex flex-col gap-1 text-aux text-muted">
        布景名称
        <input className="field" name="scene-name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-aux text-ink-2">
        {SCENE_ROWS.map((k) => (
          <div key={k} className="contents">
            <dt className="text-muted">{STYLE_LABELS[k]}</dt>
            <dd>{params[k] || (k === 'props' ? NO_PROPS : '—')}</dd>
          </div>
        ))}
      </dl>
      <p className="text-label text-muted">
        {mode === 'update' && existing
          ? `会生成第 ${existing.version + 1} 版${changes.length ? `，改了：${changes.join('、')}` : '，内容和现在一样'}；已经用过旧版的作品和结果不受影响。`
          : '只存背景、光线、摆放这些方案参数，不带这件作品的照片、故事和尺寸。'}
      </p>
      {(problem || blocked) && <p className="text-aux text-warn">{problem ?? blocked}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || !!blocked}
          onClick={async () => {
            setPending(true);
            setProblem(null);
            const r = await saveSceneFromWork(workId, name, mode === 'update' ? updateSceneId : undefined).catch((e: unknown) => ({
              ok: false as const,
              reason: e instanceof Error ? e.message : String(e),
            }));
            setPending(false);
            if (r.ok) onSaved();
            else setProblem(r.reason);
          }}
        >
          {mode === 'update' ? '更新布景' : '存为布景'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {cancelText}
        </button>
      </div>
    </div>
  );
}

export function ShopStyleForm({
  fields,
  reason,
  onSaved,
  onCancel,
  cancelText = '取消',
}: {
  fields?: readonly StyleKey[];
  reason: string;
  onSaved: () => void;
  onCancel: () => void;
  cancelText?: string;
}) {
  const { ctx, workId } = useWorkspace();
  const shop = useLiveQuery(() => getShopStyle(), []);
  const all = shopItemsOf(ctx.work);
  const [picked, setPicked] = useState<StyleKey[]>(() => (fields ?? STYLE_KEYS).filter((k) => k !== 'expression' && all[k]));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!shop) return null;
  const candidates = STYLE_KEYS.filter((k) => all[k]);
  const diff = shopDiff(shop, shopItemsOf(ctx.work, picked));
  const changed = Object.keys(diff) as StyleKey[];

  return (
    <div className="flex flex-col gap-3">
      {reason && <p className="text-aux text-ink-2">{reason}</p>}
      <ul className="flex flex-col gap-1 text-aux">
        {candidates.map((k) => {
          const before = shop.prefs[k] ?? '';
          const same = before.trim() === all[k]!.trim();
          return (
            <li key={k}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={picked.includes(k)}
                  disabled={same}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))}
                />
                <span className="w-14 shrink-0 text-muted">{STYLE_LABELS[k]}</span>
                <span className={same ? 'text-muted' : 'text-ink-2'}>
                  {same ? `${before}（和现在一样）` : `${before || '（没有）'} → ${all[k]}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-label text-muted">只改长期风格，这件作品和其他作品现有的方案都不变；以后新作品可以选择套用。</p>
      {problem && <p className="text-aux text-warn">{problem}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || !changed.length}
          onClick={async () => {
            setPending(true);
            setProblem(null);
            const r = await saveShopFromWork(workId, changed, reason).catch((e: unknown) => ({
              ok: false as const,
              reason: e instanceof Error ? e.message : String(e),
            }));
            setPending(false);
            if (r.ok) onSaved();
            else setProblem(r.reason);
          }}
        >
          {changed.length ? `同意，更新 ${changed.length} 项` : '没有要更新的'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {cancelText}
        </button>
      </div>
    </div>
  );
}
