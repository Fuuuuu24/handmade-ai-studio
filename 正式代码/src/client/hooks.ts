'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isBuiltinBackdrop } from '@/config/backdrops';
import { db } from '@/data/db';
import { refOfBackdrop, refOfBuiltin } from '@/domain/backdrops';
import type { Approval, Backdrop, BackdropApproval, BackdropRef, Id, SceneApproval } from '@/domain/types';
import { fetchConfig, type AppConfig } from './api';
import { acquireBlobUrl, blobFailedSnapshot, blobUrlSnapshot, releaseBlobUrl, subscribeBlobUrls } from './blob-urls';
import { deriveContext, loadState, resolveBackdrop, type WorkContext } from './work-store';

// 实时读取一件作品的全部数据：数据库一变，界面跟着变（数据只存在 IndexedDB 一处）
export function useWorkContext(workId: Id): WorkContext | null | undefined {
  return useLiveQuery(async () => {
    const work = await db().works.get(workId);
    if (!work) return null;
    return deriveContext(await loadState(work));
  }, [workId]);
}

const asBackdrop = (a: Approval | undefined) => (a?.kind === 'backdrop' ? (a as BackdropApproval) : null);
const asScene = (a: Approval | undefined) => (a?.kind === 'scene' ? (a as SceneApproval) : null);

// 选定的背景图在一组已读出的背景图里找；内置模板从配置里取
export function refIn(backdrops: ReadonlyMap<Id, Backdrop>, id: Id | null | undefined): BackdropRef | null {
  if (!id) return null;
  if (isBuiltinBackdrop(id)) return refOfBuiltin(id);
  const b = backdrops.get(id);
  return b ? refOfBackdrop(b) : null;
}

const groupByWork = <T extends { workId: Id }>(list: T[]) => {
  const map = new Map<Id, T[]>();
  for (const x of list) {
    const arr = map.get(x.workId);
    if (arr) arr.push(x);
    else map.set(x.workId, [x]);
  }
  return map;
};

export interface Library {
  works: WorkContext[]; // 按最近更新排序
  approvals: Approval[]; // 全部批准记录，历史结果用来查方案版本和背景图
  backdrops: Map<Id, Backdrop>; // 全部背景图（含没沉淀和已删除的），模板库、历史结果用
}

// 全部作品及其素材、任务、结果、背景图（作品页、历史结果页、模板库用）；只读元数据，不读图片本身
export function useLibrary(): Library | undefined {
  return useLiveQuery(async () => {
    const d = db();
    const [works, assets, tasks, results, approvals, backdrops] = await Promise.all([
      d.works.orderBy('updatedAt').reverse().toArray(),
      d.assets.toArray(),
      d.tasks.toArray(),
      d.results.toArray(),
      d.approvals.toArray(),
      d.backdrops.toArray(),
    ]);
    const [a, t, r, b] = [groupByWork(assets), groupByWork(tasks), groupByWork(results), groupByWork(backdrops)];
    const approvalById = new Map(approvals.map((x) => [x.id, x]));
    const backdropById = new Map(backdrops.map((x) => [x.id, x]));
    return {
      works: works.map((w) =>
        deriveContext({
          work: w,
          assets: a.get(w.id) ?? [],
          tasks: t.get(w.id) ?? [],
          results: r.get(w.id) ?? [],
          backdrops: b.get(w.id) ?? [],
          backdrop: refIn(backdropById, w.backdropId),
          backdropApproval: asBackdrop(w.backdropApprovalId ? approvalById.get(w.backdropApprovalId) : undefined),
          approval: asScene(w.approvalId ? approvalById.get(w.approvalId) : undefined),
        }),
      ),
      approvals,
      backdrops: backdropById,
    };
  }, []);
}

// 本地图片转成可显示的地址（client/blob-urls.ts 负责缓存和释放）
export function useBlobUrl(blobId: Id | null | undefined): string | null {
  const url = useSyncExternalStore(subscribeBlobUrls, () => blobUrlSnapshot(blobId), () => null);
  useEffect(() => {
    if (!blobId) return;
    acquireBlobUrl(blobId);
    return () => releaseBlobUrl(blobId);
  }, [blobId]);
  return url;
}

// 一组本地图片的显示地址（历史结果页的瀑布流用）：返回和 ids 同顺序的地址，读不出来的为 null
export function useBlobUrls(ids: readonly Id[]): { urls: (string | null)[]; failed: boolean[] } {
  const key = ids.join('|');
  // 快照用字符串，内容变了才重新渲染
  const snap = useSyncExternalStore(
    subscribeBlobUrls,
    () => ids.map((id) => `${blobUrlSnapshot(id) ?? ''}${blobFailedSnapshot(id) ? '!' : ''}`).join('|'),
    () => '',
  );
  useEffect(() => {
    const list = key ? key.split('|') : [];
    list.forEach(acquireBlobUrl);
    return () => list.forEach(releaseBlobUrl);
  }, [key]);
  void snap;
  return { urls: ids.map((id) => blobUrlSnapshot(id)), failed: ids.map((id) => blobFailedSnapshot(id)) };
}

// 本地图片是否读不出来（找不到或损坏）：用来在图片位置显示原因
export const useBlobFailed = (blobId: Id | null | undefined) =>
  useSyncExternalStore(subscribeBlobUrls, () => blobFailedSnapshot(blobId), () => false);

type ConfigState = { config: AppConfig | null; error: string | null };
let cached: Promise<AppConfig> | null = null;

// 服务端的模型清单与预算余量；读取失败如实显示，不假装可用
export function useAppConfig(): ConfigState & { reload: () => void } {
  const [state, setState] = useState<ConfigState>({ config: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    cached ??= fetchConfig();
    cached.then(
      (config) => live && setState({ config, error: null }),
      (e: unknown) => {
        cached = null;
        if (live) setState({ config: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [nonce]);
  return {
    ...state,
    reload: () => {
      cached = null;
      setNonce((n) => n + 1);
    },
  };
}

// 按编号读一张背景图（内置模板或数据库里的）：出图页、历史结果写明每轮用的是哪张
export function useBackdropRef(id: Id | null | undefined): BackdropRef | null | undefined {
  return useLiveQuery(() => resolveBackdrop(id), [id]);
}
