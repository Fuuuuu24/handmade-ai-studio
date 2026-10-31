import { getBlob } from '@/data/repo';

/* 本地图片的显示地址：按图片编号缓存（图片内容不可变，新内容总是新编号），引用计数归零后延迟释放，
   开发模式下组件重复挂载时不会提前释放。 */

interface Entry {
  url: string | null; // null 表示正在读取或图片不存在
  refs: number;
  loading: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribeBlobUrls(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const blobUrlSnapshot = (id: string | null | undefined) => (id ? (entries.get(id)?.url ?? null) : null);

export function acquireBlobUrl(id: string) {
  let e = entries.get(id);
  if (!e) {
    e = { url: null, refs: 0, loading: false };
    entries.set(id, e);
  }
  if (e.timer) clearTimeout(e.timer);
  e.timer = undefined;
  e.refs += 1;
  if (!e.url && !e.loading) {
    const entry = e;
    entry.loading = true;
    getBlob(id)
      .then((blob) => {
        entry.loading = false;
        if (blob && entries.get(id) === entry) {
          entry.url = URL.createObjectURL(blob);
          notify();
        }
      })
      .catch((err) => {
        entry.loading = false;
        console.error('图片读取失败', id, err);
      });
  }
}

export function releaseBlobUrl(id: string) {
  const e = entries.get(id);
  if (!e) return;
  e.refs -= 1;
  if (e.refs > 0) return;
  e.timer = setTimeout(() => {
    if (e.refs > 0) return;
    if (e.url) URL.revokeObjectURL(e.url);
    entries.delete(id);
  }, 2000);
}
