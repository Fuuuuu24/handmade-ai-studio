import 'server-only';
import path from 'node:path';
import { NotConfiguredError } from './errors';

// 密钥只在服务端读取，不发给浏览器
export function apiKey(): string {
  const key = process.env.AIHUBMIX_API_KEY?.trim();
  if (!key) throw new NotConfiguredError('服务端没有配置 AIHubMix 密钥，生图和小间暂时不可用');
  return key;
}

export const ledgerPath = () => process.env.LEDGER_PATH || path.join(process.cwd(), 'data', 'ledger.json');
