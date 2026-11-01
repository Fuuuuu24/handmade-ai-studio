// 保存状态（AC-01.4）：写入成功才显示「已保存」；失败说明原因、保留界面上的内容，可重试。
// 按 key 记录失败：同一个 key 之后写入成功才算恢复，别的写入成功不会掩盖这次失败。
export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string; retry: () => Promise<void> };

interface Failure {
  message: string;
  retry: () => Promise<void>;
}

let pending = 0;
let lastSaved = 0;
const failures = new Map<string, Failure>();
const listeners = new Set<() => void>();
let snapshot: SaveStatus = { state: 'idle' };

function recompute() {
  const failure = failures.values().next().value;
  snapshot = failure
    ? { state: 'error', ...failure }
    : pending > 0
      ? { state: 'saving' }
      : lastSaved
        ? { state: 'saved', at: lastSaved }
        : { state: 'idle' };
  listeners.forEach((fn) => fn());
}

export const getSaveStatus = () => snapshot;

export function subscribeSave(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const inner = (e as { inner?: { name?: string } })?.inner?.name ?? '';
  if (name === 'QuotaExceededError' || inner === 'QuotaExceededError') return '浏览器存储空间不足，内容没有保存';
  if (name === 'InvalidStateError' || name === 'DatabaseClosedError' || name === 'MissingAPIError') {
    return '浏览器存储不可用（可能处于无痕模式），内容没有保存';
  }
  return `保存失败：${e instanceof Error ? e.message : String(e)}`;
}

// 包住一次写入。失败时把错误抛给调用方，同时在状态里留一个重试入口
export async function tracked<T>(key: string, op: () => Promise<T>): Promise<T> {
  pending += 1;
  recompute();
  try {
    const value = await op();
    failures.delete(key);
    lastSaved = Date.now();
    return value;
  } catch (e) {
    failures.set(key, {
      message: describeStorageError(e),
      retry: async () => {
        await tracked(key, op);
      },
    });
    throw e;
  } finally {
    pending -= 1;
    recompute();
  }
}

// 只给测试用
export function resetSaveStatus() {
  pending = 0;
  lastSaved = 0;
  failures.clear();
  recompute();
}
