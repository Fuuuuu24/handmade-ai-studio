'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { db } from '@/data/db';
import type { Approval, Id } from '@/domain/types';
import { fetchConfig, type AppConfig } from './api';
import { acquireBlobUrl, blobUrlSnapshot, releaseBlobUrl, subscribeBlobUrls } from './blob-urls';
import { deriveContext, type WorkContext } from './work-store';

// 实时读取一件作品的全部数据：数据库一变，界面跟着变（数据只存在 IndexedDB 一处）
export function useWorkContext(workId: Id): WorkContext | null | undefined {
  return useLiveQuery(async () => {
    const d = db();
    const work = await d.works.get(workId);
    if (!work) return null;
    const [assets, tasks, results, approval] = await Promise.all([
      d.assets.where('workId').equals(workId).toArray(),
      d.tasks.where('workId').equals(workId).toArray(),
      d.results.where('workId').equals(workId).toArray(),
      work.approvalId ? d.approvals.get(work.approvalId) : Promise.resolve(undefined),
    ]);
    return deriveContext(work, assets, approval ?? null, tasks, results);
  }, [workId]);
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
  approvals: Approval[]; // 全部批准记录，历史结果用来查方案版本
}

// 全部作品及其素材、任务、结果（作品页、历史结果页、布景页用）；只读元数据，不读图片本身
export function useLibrary(): Library | undefined {
  return useLiveQuery(async () => {
    const d = db();
    const [works, assets, tasks, results, approvals] = await Promise.all([
      d.works.orderBy('updatedAt').reverse().toArray(),
      d.assets.toArray(),
      d.tasks.toArray(),
      d.results.toArray(),
      d.approvals.toArray(),
    ]);
    const [a, t, r] = [groupByWork(assets), groupByWork(tasks), groupByWork(results)];
    const byId = new Map(approvals.map((x) => [x.id, x]));
    return {
      works: works.map((w) =>
        deriveContext(w, a.get(w.id) ?? [], (w.approvalId && byId.get(w.approvalId)) || null, t.get(w.id) ?? [], r.get(w.id) ?? []),
      ),
      approvals,
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
