'use client';

import { useState, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from 'react';

/* 编辑中的输入框：聚焦时才有本地草稿，失焦时提交；不聚焦时直接显示数据库里的最新值。
   小间同时改了同一个字段时，不会覆盖用户正在输入的内容。 */

function useDraft(value: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && draft !== value) onCommit(draft);
      setDraft(null);
    },
    cancel: () => setDraft(null),
  };
}

type Common = { value: string; onCommit: (v: string) => void };

export function DraftInput({
  value,
  onCommit,
  onKeyDown,
  ref,
  ...rest
}: Common & { ref?: Ref<HTMLInputElement> } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus'>) {
  const d = useDraft(value, onCommit);
  return (
    <input
      {...rest}
      ref={ref}
      value={d.value}
      onFocus={d.onFocus}
      onChange={d.onChange}
      onBlur={d.onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur();
        if (e.key === 'Escape') {
          const el = e.currentTarget;
          d.cancel();
          requestAnimationFrame(() => el.blur()); // 等草稿清掉后再失焦，避免把取消的内容提交
        }
        onKeyDown?.(e);
      }}
    />
  );
}

export function DraftTextarea({ value, onCommit, ...rest }: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus'>) {
  const d = useDraft(value, onCommit);
  return <textarea {...rest} value={d.value} onFocus={d.onFocus} onChange={d.onChange} onBlur={d.onBlur} />;
}
