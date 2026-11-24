'use client';

import { NO_PROPS, STYLE_OPTIONS, STYLE_SHORT, TONE_OPTIONS, type StyleKey } from '@/config/style';
import { mutateWork } from '@/client/work-store';
import type { StyleSource } from '@/domain/types';
import { setStyle } from '@/domain/work';
import { DraftInput } from '@/components/ui/draft-field';
import { useWorkspace } from '@/components/workspace/context';

const SOURCE_TAG: Partial<Record<StyleSource, [string, string]>> = {
  recommend: ['小间推荐', 'text-accent'],
  said: ['你说的', 'text-muted'],
};

const toneSwatch = (name: string) => TONE_OPTIONS.find((t) => t.name === name)?.colors;

const PLACEHOLDER: Partial<Record<StyleKey, string>> = {
  props: NO_PROPS,
  bannedBackdrop: '比如：花、玻璃器皿',
  bannedScene: '比如：手、文字',
};

// 风格卡的一行（背景卡、摆放卡共用）。有常用选项的项：选项胶囊＋行末「自己描述」小输入框，输入框只显示选项以外的说法
// （v2 第三次改版已确认）；道具、禁止出现没有选项，用整行输入。fixed 不为空时只读显示（背景图选定后以背景图的参数为准）
export function StyleRow({ k, locked, fixed }: { k: StyleKey; locked: boolean; fixed?: string | null }) {
  const { ctx, workId } = useWorkspace();
  const v = ctx.work.style[k];
  const options = STYLE_OPTIONS[k] ?? [];
  const set = (value: string) => void mutateWork(workId, (c) => setStyle(c.work, k, value, 'user'));
  const label = (
    <span id={`style-${k}-label`} className="text-aux text-muted">
      {STYLE_SHORT[k]}
    </span>
  );

  if (fixed !== undefined) {
    return (
      <div className="grid grid-cols-[64px_1fr] items-start gap-3 border-b border-line py-2 last:border-b-0">
        <div className="pt-0.5">{label}</div>
        <p className={`text-body ${fixed ? 'text-ink-2' : 'text-placeholder'}`}>{fixed || (k === 'props' ? NO_PROPS : '没写')}</p>
      </div>
    );
  }

  const tag = v.value ? SOURCE_TAG[v.source] : undefined;
  const custom = v.value && !options.includes(v.value) ? v.value : '';
  return (
    <div className="grid grid-cols-[64px_1fr] items-start gap-3 border-b border-line py-2.5 last:border-b-0">
      <div className="flex flex-col gap-0.5 pt-1">
        <label htmlFor={`style-${k}`} className="text-aux text-muted">
          {STYLE_SHORT[k]}
        </label>
        {tag && (
          <span className={`text-label ${tag[1]}`} title={v.reason}>
            {tag[0]}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {options.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby={`style-${k}-label`}>
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
            placeholder={PLACEHOLDER[k] ?? '用自己的话描述'}
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
