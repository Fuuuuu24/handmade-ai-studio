'use client';

/* React Bits「Prompt Bar」（见上级目录 README.md）。按本项目裁剪：
   - 保留：「＋」菜单、「/」命令、模型选择（改成可以有多个选择器：对话模型、生图模型）、发送与停止的变形按钮、菜单高亮滑块、输入框自动长高。
   - 去掉：强度滑杆（efforts）、语音输入（onDictate）、火花特效、「@」来源与附件名标签（照片由外层直接上传）。
   - 输入内容改为受控（value／onChange），外层上传照片后可以清空；「/」命令可以直接执行（run），不只是插入文字。
   - 中文文案、项目图标与浅色配色；补上键盘焦点描边；输入法选字时的回车不发送（Safari 用 keyCode 229）。 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { Icon, type IconName } from '@/components/ui/icon';
import './PromptBar.css';

export interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: IconName;
  disabled?: boolean;
  onPick: () => void;
}

export interface PromptBarCommand {
  key: string;
  name: string; // 带斜杠，比如「/推荐」
  description?: string;
  run?: () => void; // 有 run 时选中即执行；没有时把命令插进输入框
}

export interface PromptBarOption {
  key: string;
  name: string;
  tag?: string;
}

export interface PromptBarPicker {
  key: string;
  label: string; // 读屏名称，比如「对话模型」
  prefix?: string; // 按钮上名字前的小字，比如「对话」
  options: PromptBarOption[];
  value: string;
  disabled?: boolean;
  title?: string;
  onChange: (key: string) => void;
}

export interface PromptBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputId?: string;
  inputName?: string;
  inputLabel?: string;
  sources?: PromptBarSource[];
  sourcesLabel?: string;
  sourcesDisabled?: boolean;
  sourcesTitle?: string;
  commands?: PromptBarCommand[];
  pickers?: PromptBarPicker[];
  busy?: boolean;
  onSend?: (text: string) => void;
  onStop?: () => void;
  top?: ReactNode; // 输入框上方的一行（比如快捷回答）
  status?: ReactNode; // 底栏右侧、发送按钮前的状态文字
  radius?: number;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
  className?: string;
}

type Row = { key: string; name: string; description?: string; tag?: string; icon?: IconName; disabled?: boolean };
type Open = 'plus' | 'slash' | `picker:${string}` | null;
type Latest = Pick<PromptBarProps, 'onSend' | 'onStop'>;

interface SendGlyphProps {
  busy: boolean;
  morphDuration: number;
  squash: number;
  tilt: number;
}

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const LINE = 22;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pathAt = (a: number[], b: number[], t: number) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
};

// 只认行首或空格后的「/」，命令名可以是中文
const parseSlash = (draft: string): { query: string; start: number } | null => {
  const m = /(^|\s)\/([^\s/]*)$/.exec(draft);
  if (!m) return null;
  return { query: m[2].toLowerCase(), start: m.index + m[1].length };
};

function SendGlyph({ busy, morphDuration, squash, tilt }: SendGlyphProps) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(t, target, reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT });
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', v => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, busy ? 1 : 0)} />
    </svg>
  );
}

const PromptBar: React.FC<PromptBarProps> = ({
  value: draft,
  onChange: setDraft,
  placeholder = '',
  inputId,
  inputName,
  inputLabel = '输入',
  sources = [],
  sourcesLabel = '添加',
  sourcesDisabled = false,
  sourcesTitle,
  commands = [],
  pickers = [],
  busy = false,
  onSend,
  onStop,
  top,
  status,
  radius = 12,
  maxRows = 7,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.94,
  className = ''
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastOpen = useRef<Open>(null);
  const latest = useRef<Latest>({});
  latest.current = { onSend, onStop };

  const [menu, setMenu] = useState<'plus' | `picker:${string}` | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [pressed, setPressed] = useState(false);

  const token = dismissed || !commands.length ? null : parseSlash(draft);
  const open: Open = menu ?? (token ? 'slash' : null);
  const picker = open?.startsWith('picker:') ? pickers.find(p => `picker:${p.key}` === open) : undefined;
  const list = useMemo<Row[]>(() => {
    if (open === 'plus') return sources;
    if (open === 'slash') return commands.filter(c => c.name.replace(/^\//, '').toLowerCase().startsWith(token?.query ?? ''));
    if (picker) return picker.options;
    return [];
  }, [open, sources, commands, token?.query, picker]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = draft.trim().length > 0;
  const armed = busy || canSend;

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const closeMenus = useCallback(() => setMenu(null), []);

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = 'none';
    glow.style.top = `${row.offsetTop}px`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = '1';
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = '';
    }
  }, [open, cursor, list]);
  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenus();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu, closeMenus]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  // 先把焦点移到输入框再开菜单：键盘按按钮时焦点从按钮移进输入框，会触发输入框的 onFocus 关菜单（上游缺陷，鼠标点不受影响）
  const toggle = (next: NonNullable<typeof menu>, start = 0) => {
    const wasOpen = menu === next;
    focusInput();
    setActive(start);
    setMenu(wasOpen ? null : next);
  };

  const pick = (row: Row) => {
    if (row.disabled) return;
    if (picker) {
      if (row.key !== picker.value) picker.onChange(row.key);
      setMenu(null);
      focusInput();
      return;
    }
    if (open === 'plus') {
      setMenu(null);
      sources.find(s => s.key === row.key)?.onPick();
      return;
    }
    const cmd = commands.find(c => c.key === row.key);
    const head = token ? draft.slice(0, token.start) : draft;
    if (cmd?.run) {
      setDraft(head.trimEnd());
      cmd.run();
    } else {
      setDraft(`${head}${row.name} `);
    }
    setDismissed(false);
    focusInput();
  };

  const send = () => {
    if (!canSend || busy) return;
    latest.current.onSend?.(draft.trim());
    setDismissed(false);
    closeMenus();
    focusInput();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (open && list.length && !composing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault();
      send();
    }
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  const menuLabel = open === 'plus' ? sourcesLabel : open === 'slash' ? '命令' : (picker?.label ?? '');

  return (
    <div
      ref={rootRef}
      className={`prompt-bar${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      style={{ '--pb-radius': `${radius}px`, '--pb-press': pressScale } as CSSProperties}
    >
      {open ? (
        <div className="prompt-bar__menu" role="listbox" aria-label={menuLabel} data-kind={open === 'plus' || open === 'slash' ? open : 'picker'}>
          <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
          {list.map((row, i) => (
            <button
              key={row.key}
              ref={el => {
                rowRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={picker ? row.key === picker.value : i === cursor}
              aria-disabled={row.disabled || undefined}
              data-active={i === cursor ? '' : undefined}
              className="prompt-bar__row"
              tabIndex={-1}
              onMouseDown={e => e.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(row)}
            >
              {row.icon ? (
                <span className="prompt-bar__row-icon">
                  <Icon name={row.icon} size={15} />
                </span>
              ) : null}
              <span className="prompt-bar__row-name">{row.name}</span>
              {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
              {picker ? (
                <>
                  {row.tag ? <span className="prompt-bar__row-tag">{row.tag}</span> : null}
                  <span className="prompt-bar__row-check" data-on={row.key === picker.value ? '' : undefined}>
                    <Icon name="check" size={14} />
                  </span>
                </>
              ) : null}
            </button>
          ))}
          {list.length === 0 ? <div className="prompt-bar__empty">没有「{token?.query}」这个命令</div> : null}
        </div>
      ) : null}

      <div
        className="prompt-bar__field"
        role="presentation"
        onPointerDown={e => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={e => {
          if (e.target === e.currentTarget) focusInput();
        }}
      >
        {top}
        <textarea
          ref={inputRef}
          id={inputId}
          name={inputName}
          className="prompt-bar__input"
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label={inputLabel}
          onChange={e => {
            setDraft(e.target.value);
            setDismissed(false);
            closeMenus();
            setActive(0);
          }}
          onFocus={closeMenus}
          onKeyDown={onKeyDown}
        />

        <div className="prompt-bar__bar">
          {sources.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label={sourcesLabel}
              title={sourcesTitle ?? sourcesLabel}
              aria-expanded={menu === 'plus'}
              data-on={menu === 'plus' ? '' : undefined}
              disabled={sourcesDisabled}
              onMouseDown={e => e.preventDefault()}
              onClick={() => toggle('plus')}
            >
              <Icon name="plus" size={16} />
            </button>
          ) : null}
          {pickers.map(p => {
            const current = p.options.find(o => o.key === p.value);
            const key = `picker:${p.key}` as const;
            return (
              <button
                key={p.key}
                type="button"
                className="prompt-bar__pick"
                aria-label={`${p.label}：${current?.name ?? p.value}`}
                aria-expanded={menu === key}
                title={p.title}
                data-on={menu === key ? '' : undefined}
                disabled={p.disabled}
                onMouseDown={e => e.preventDefault()}
                onClick={() => toggle(key, Math.max(0, p.options.findIndex(o => o.key === p.value)))}
              >
                {p.prefix ? <span className="prompt-bar__pick-prefix">{p.prefix}</span> : null}
                <span className="prompt-bar__pick-name">{current?.name ?? `${p.value}（未配置）`}</span>
                <Icon name="chevronDown" size={12} />
              </button>
            );
          })}
          <span className="prompt-bar__spacer" />
          {status}
          <button
            type="button"
            className="prompt-bar__send"
            disabled={!armed}
            aria-label={busy ? '停止回复' : '发送'}
            data-armed={armed ? '' : undefined}
            data-pressed={pressed ? '' : undefined}
            onMouseDown={e => e.preventDefault()}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onClick={() => {
              if (busy) latest.current.onStop?.();
              else send();
            }}
          >
            <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptBar;
