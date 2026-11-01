'use client';

import { useSyncExternalStore } from 'react';
import { getSaveStatus, subscribeSave } from '@/data/save';

// 保存状态（AC-01.4）：写入成功才显示「已保存」；失败说明原因并可重试
export function SaveStatusText() {
  const s = useSyncExternalStore(subscribeSave, getSaveStatus, getSaveStatus);
  if (s.state === 'idle') return null;
  if (s.state === 'error') {
    return (
      <span role="alert" className="ml-2 inline-flex items-center gap-2 text-aux text-bad">
        {s.message}
        <button type="button" className="mini-btn" onClick={() => void s.retry().catch(() => undefined)}>
          重试保存
        </button>
      </span>
    );
  }
  return (
    <span className="ml-2 text-label text-muted" aria-live="polite">
      {s.state === 'saving' ? '保存中…' : '已保存'}
    </span>
  );
}
