import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BUDGET } from '@/config/budget';
import { budgetCheck } from '@/domain/cost';
import { newId } from '@/domain/util';
import { ledgerPath } from './env';
import { BudgetError } from './errors';

/* 花费账本：存在服务端本地文件（技术写法第 7 节），不放浏览器，防止被改。
   调用前按估价预留，结束后按实际用量结算；确认没扣费的（如内容被拦截）退回。 */

export interface LedgerEntry {
  id: string;
  at: number;
  kind: 'chat' | 'image';
  model: string;
  estUSD: number;
  actualUSD?: number;
  status: 'reserved' | 'settled' | 'refunded';
  ref?: string; // 网关任务编号
}

interface LedgerFile {
  version: 1;
  entries: LedgerEntry[];
}

// 同一进程内串行读写，避免两次请求同时改文件
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function load(): Promise<LedgerFile> {
  try {
    return JSON.parse(await fs.readFile(ledgerPath(), 'utf8')) as LedgerFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] };
    throw new Error(`花费账本读不出来（${ledgerPath()}），为防止超支暂停调用：${(e as Error).message}`);
  }
}

async function save(ledger: LedgerFile) {
  const file = ledgerPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 1));
  await fs.rename(tmp, file); // 先写临时文件再改名，中途断电也不会留下半个文件
}

const costOf = (e: LedgerEntry) => (e.status === 'refunded' ? 0 : e.status === 'settled' ? (e.actualUSD ?? e.estUSD) : e.estUSD);
const spentOf = (l: LedgerFile) => l.entries.reduce((sum, e) => sum + costOf(e), 0);

export function reserve(kind: LedgerEntry['kind'], model: string, estUSD: number): Promise<LedgerEntry> {
  return locked(async () => {
    const ledger = await load();
    const check = budgetCheck(spentOf(ledger), estUSD, BUDGET.totalUSD);
    if (!check.ok) throw new BudgetError(check.reason);
    const entry: LedgerEntry = { id: newId('led'), at: Date.now(), kind, model, estUSD, status: 'reserved' };
    ledger.entries.push(entry);
    await save(ledger);
    return entry;
  });
}

async function update(id: string, patch: (e: LedgerEntry) => Partial<LedgerEntry> | null) {
  return locked(async () => {
    const ledger = await load();
    const entry = ledger.entries.find((e) => e.id === id);
    if (!entry) return null;
    const p = patch(entry);
    if (!p) return entry;
    Object.assign(entry, p);
    await save(ledger);
    return entry;
  });
}

export const settle = (id: string, actualUSD: number) => update(id, () => ({ status: 'settled', actualUSD }));
export const attachRef = (id: string, ref: string) => update(id, () => ({ ref }));

// 退回只认对得上的任务编号，避免误退
export const refund = (id: string, ref?: string) =>
  update(id, (e) => (e.status === 'reserved' && (!ref || e.ref === ref) ? { status: 'refunded' } : null));

export async function budgetSummary() {
  const ledger = await load();
  const spentUSD = spentOf(ledger);
  return { spentUSD, totalUSD: BUDGET.totalUSD, remainingUSD: Math.max(0, BUDGET.totalUSD - spentUSD) };
}
