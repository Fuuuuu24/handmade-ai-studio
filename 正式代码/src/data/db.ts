import Dexie, { type EntityTable } from 'dexie';
import type { Approval, Asset, Backdrop, BlobRecord, Result, StoredMessage, Task, TrialEvent, Work } from '@/domain/types';

/* 浏览器本地数据库（PRD O5：数据只存在用户自己的浏览器里）。图片二进制单独放 blobs，其他表只存编号。
   第 2 版（v0.6，技术写法 13.6）：加 backdrops，删掉 scenes、shopStyle；旧作品都是开发测试数据，升级时全部清空
   （2026-11-22 发起人定，不迁移）。 */

// 数据库提示：升级被别的页面挡住、这个页面的数据库被别的页面升级了、升级清空了旧数据。界面（图标栏外框）订阅后显示
export type DbNotice = 'blocked' | 'outdated' | 'cleared';

const CLEARED_KEY = 'yijian:v2-cleared';
let notice: DbNotice | null = null;
const listeners = new Set<() => void>();

function setNotice(n: DbNotice | null) {
  notice = n;
  listeners.forEach((fn) => fn());
}

export const dbNotice = () => notice;

export function subscribeDbNotice(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 「旧的测试作品已清除」只提示一次：升级时记在 localStorage，用户看过后记为已读
export function clearedPending(): boolean {
  try {
    return localStorage.getItem(CLEARED_KEY) === 'pending';
  } catch {
    return false;
  }
}

export function dismissCleared() {
  try {
    localStorage.setItem(CLEARED_KEY, 'seen');
  } catch {
    // 存不进 localStorage 也只是下次再提示一次
  }
  if (notice === 'cleared') setNotice(null);
}

const V1_TABLES = ['works', 'assets', 'blobs', 'messages', 'tasks', 'results', 'approvals', 'events'] as const;

export class YijianDB extends Dexie {
  works!: EntityTable<Work, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  blobs!: EntityTable<BlobRecord, 'id'>;
  messages!: EntityTable<StoredMessage, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  results!: EntityTable<Result, 'id'>;
  approvals!: EntityTable<Approval, 'id'>;
  backdrops!: EntityTable<Backdrop, 'id'>;
  events!: EntityTable<TrialEvent, 'id'>;

  constructor(name = 'yijian') {
    super(name);
    this.version(1).stores({
      works: 'id, updatedAt',
      assets: 'id, workId',
      blobs: 'id',
      messages: 'id, workId, [workId+seq]',
      tasks: 'id, workId, status',
      results: 'id, workId, createdAt',
      approvals: 'id, workId',
      scenes: 'id, updatedAt',
      shopStyle: 'id',
      events: 'id, at, workId',
    });
    // 以后改表结构时新增 this.version(3)；要保留数据就在 upgrade 里迁移。
    // savedAt 为空（没沉淀）的背景图不进这个索引，查模板库时只会取到沉淀过的（IndexedDB 不给布尔值建索引）
    this.version(2)
      .stores({ backdrops: 'id, workId, savedAt', scenes: null, shopStyle: null })
      .upgrade(async (tx) => {
        await Promise.all(V1_TABLES.map((t) => tx.table(t).clear()));
        try {
          localStorage.setItem(CLEARED_KEY, 'pending');
        } catch {
          // 测试环境或禁用了存储：不提示
        }
        setNotice('cleared');
      });
    // 别的标签页开着旧版、挡住了升级：请用户关掉其他页面（Dexie 只会在控制台警告）
    this.on('blocked', () => setNotice('blocked'));
    // 别的页面要升级这个数据库：Dexie 默认会关掉这里的连接；这个页面再读写会失败，提示刷新
    this.on('versionchange', () => setNotice('outdated'));
  }
}

let instance: YijianDB | null = null;

export const db = () => (instance ??= new YijianDB());

// 只给测试用：每个测试换一个独立的库
export function useTestDb(name: string) {
  instance = new YijianDB(name);
  return instance;
}
