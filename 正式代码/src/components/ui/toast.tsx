'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import SwipeToast from '@/components/bits/SwipeToast/SwipeToast';

/* 全局轻提示（React Bits Swipe Toast）：只用于操作成功的告知，可滑走、几秒后自动消失。
   出错仍在出错的位置就地显示（role="alert"），不放进会自己消失的提示里。 */

interface ToastItem {
  id: number;
  title: string;
  description?: string;
}

const ToastCtx = createContext<((title: string, description?: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const show = useCallback((title: string, description?: string) => setItem({ id: Date.now(), title, description }), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {item && (
        <SwipeToast
          key={item.id}
          title={item.title}
          description={item.description}
          width={320}
          duration={3500}
          closeButton
          onClose={() => setItem((cur) => (cur?.id === item.id ? null : cur))}
        />
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast 只能在 ToastProvider 里使用');
  return v;
}
