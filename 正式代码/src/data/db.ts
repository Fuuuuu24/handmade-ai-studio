import Dexie, { type EntityTable } from 'dexie';
import type {
  Approval,
  Asset,
  BlobRecord,
  Result,
  Scene,
  ShopStyle,
  StoredMessage,
  Task,
  TrialEvent,
  Work,
} from '@/domain/types';

// 浏览器本地数据库（PRD O5：数据只存在用户自己的浏览器里）。图片二进制单独放 blobs，其他表只存编号。
export class YijianDB extends Dexie {
  works!: EntityTable<Work, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  blobs!: EntityTable<BlobRecord, 'id'>;
  messages!: EntityTable<StoredMessage, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  results!: EntityTable<Result, 'id'>;
  approvals!: EntityTable<Approval, 'id'>;
  scenes!: EntityTable<Scene, 'id'>;
  shopStyle!: EntityTable<ShopStyle, 'id'>;
  events!: EntityTable<TrialEvent, 'id'>;

  constructor(name = 'yijian') {
    super(name);
    // 改表结构时新增 this.version(2).stores(...).upgrade(...)，用升级函数迁移，不丢旧数据
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
  }
}

let instance: YijianDB | null = null;

export const db = () => (instance ??= new YijianDB());

// 只给测试用：每个测试换一个独立的库
export function useTestDb(name: string) {
  instance = new YijianDB(name);
  return instance;
}
