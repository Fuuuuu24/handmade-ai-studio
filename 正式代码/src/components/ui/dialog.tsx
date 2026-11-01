'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';

/* 统一的弹窗：用原生 <dialog>（自带焦点管理与 Esc 关闭）。确认弹窗用 useConfirm() 以 Promise 形式拿到结果，
   替代浏览器自带的 confirm（样式不统一，也会挡住自动化测试）。
   打开时聚焦带 data-autofocus 的元素：弹窗内容早已挂载，React 的 autoFocus 只在首次挂载时生效。 */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: ReactNode;
  labelledBy?: string;
  wide?: boolean; // 看图、对照用的宽版
}

export function Modal({ open, onClose, title, sub, children, labelledBy, wide = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = labelledBy ?? `dlg-${title}`;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // 点遮罩关闭
      }}
      className={`m-auto ${wide ? 'w-[min(94vw,1080px)]' : 'w-[min(92vw,440px)]'} rounded-xl bg-white p-6 text-ink shadow-pop backdrop:bg-black/25`}
    >
      <button type="button" className="icon-btn absolute right-3.5 top-3.5" aria-label="关闭" onClick={onClose}>
        <Icon name="close" />
      </button>
      <h2 id={id} className="mb-2.5 pr-7 text-panel font-semibold">
        {title}
      </h2>
      {sub && <p className="-mt-1.5 mb-3 text-aux text-muted">{sub}</p>}
      {children}
    </dialog>
  );
}

interface ConfirmRequest {
  title: string;
  body: ReactNode;
  ok: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

const ConfirmCtx = createContext<((r: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const ask = useCallback((r: Omit<ConfirmRequest, 'resolve'>) => new Promise<boolean>((resolve) => setReq({ ...r, resolve })), []);
  const close = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!req} onClose={() => close(false)} title={req?.title ?? ''} labelledBy="confirm-title">
        <div className="text-body leading-relaxed text-ink-2">{req?.body}</div>
        {/* 删除这类危险操作默认聚焦「取消」，误按回车不会删掉 */}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)} data-autofocus={req?.danger ? '' : undefined}>
            取消
          </button>
          <button
            type="button"
            className={`btn ${req?.danger ? 'bg-bad text-white hover:bg-[#9a1d14]' : 'btn-primary'}`}
            onClick={() => close(true)}
            data-autofocus={req?.danger ? undefined : ''}
          >
            {req?.ok ?? '确定'}
          </button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ask = useContext(ConfirmCtx);
  if (!ask) throw new Error('useConfirm 需要放在 ConfirmProvider 里');
  return ask;
}
