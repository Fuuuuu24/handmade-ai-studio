import 'server-only';
import { promises as fs } from 'node:fs';
import { CREDENTIALS } from '@/config/credentials';
import { GATEWAY } from '@/config/models';
import { parseCredentialFile, parseMasterKey, tokenMatches, unseal, type CredentialFile, type SealedSecret } from './credential-file';
import { NotConfiguredError } from './errors';
import { rememberSecret } from './redact';

/* 凭据来源（技术写法第 12.2 节）：
   - env：.env.local 的 AIHUBMIX_API_KEY（不设 CREDENTIAL_SOURCE 时的默认，和以前一样）
   - file：管理后台写的加密凭据文件（服务器上用）
   - relay：协作者本地，请求经服务器转发，凭团队口令，自己不拿真 key
   来源之间不互相回退：file 模式出了问题就报错，不改用环境变量。凭据文件每次调用现读，后台一改，下一个请求就用新的。 */

export type CredentialSource = 'env' | 'file' | 'relay';
const PROVIDER = 'aihubmix';

export function credentialSource(): CredentialSource {
  const value = process.env.CREDENTIAL_SOURCE?.trim() || 'env';
  if (value === 'env' || value === 'file' || value === 'relay') return value;
  throw new NotConfiguredError(`CREDENTIAL_SOURCE 只能是 env、file 或 relay，现在是「${value}」`);
}

function envKey(): string {
  const key = process.env.AIHUBMIX_API_KEY?.trim();
  if (!key) throw new NotConfiguredError('服务端没有配置 AIHubMix 密钥，生图和小间暂时不可用');
  return rememberSecret(key);
}

// MODEL_RELAY_URL 只填服务器地址，转发路径按供应商由这里拼上（要和 app/api/relay/<供应商>/[...path] 的位置一致）：
// 以后加供应商，协作者不用改配置（技术写法第 12.11 节）
function relayConfig() {
  const raw = process.env.MODEL_RELAY_URL?.trim();
  const token = process.env.MODEL_RELAY_TOKEN?.trim();
  if (!raw || !token) throw new NotConfiguredError('转发模式要在 .env.local 设置 MODEL_RELAY_URL 和 MODEL_RELAY_TOKEN（找发起人要）');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new NotConfiguredError('MODEL_RELAY_URL 不是有效网址');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new NotConfiguredError('MODEL_RELAY_URL 只填服务器地址（比如 https://example.com），不要带路径');
  }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new NotConfiguredError('MODEL_RELAY_URL 要用 https（本机测试可以用 http://127.0.0.1）');
  }
  return { base: `${parsed.origin}/api/relay/${PROVIDER}`, token: rememberSecret(token) };
}

async function readCredentialFile(): Promise<{ file: CredentialFile; master: Buffer }> {
  const filePath = process.env.CREDENTIALS_PATH?.trim();
  if (!filePath) throw new NotConfiguredError('服务器没有设置凭据文件位置（CREDENTIALS_PATH）');
  let master: Buffer;
  try {
    master = parseMasterKey(process.env.CREDENTIALS_MASTER_KEY);
  } catch (e) {
    throw new NotConfiguredError((e as Error).message);
  }
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotConfiguredError('还没有在管理后台配置 key（凭据文件不存在）');
    throw new NotConfiguredError(`凭据文件读不出来：${(e as Error).message}`);
  }
  try {
    return { file: parseCredentialFile(text), master };
  } catch (e) {
    throw new NotConfiguredError((e as Error).message);
  }
}

function providerEntry(file: CredentialFile) {
  const entry = file.providers[PROVIDER];
  if (!entry) throw new NotConfiguredError('还没有在管理后台配置 AIHubMix key');
  return entry;
}

function open(master: Buffer, box: SealedSecret): string {
  try {
    return rememberSecret(unseal(master, PROVIDER, box));
  } catch (e) {
    throw new NotConfiguredError(`AIHubMix key ${(e as Error).message}`);
  }
}

// 新请求（对话、提交生图）用的凭据：file 模式下必须是启用状态
export async function gatewayKey(): Promise<string> {
  const source = credentialSource();
  if (source === 'env') return envKey();
  if (source === 'relay') return relayConfig().token;
  const { file, master } = await readCredentialFile();
  const entry = providerEntry(file);
  if (entry.status !== 'active') throw new NotConfiguredError('AIHubMix key 已被维护者停用，暂时不能发起新的对话和生图');
  return open(master, entry.key);
}

// 查询和取回已提交的生图用的凭据：停用不拦（免得已扣费的图拿不回来）；
// 当前 key 之后跟着替换不满宽限期的上一把（AIHubMix 的任务按创建它的 key 隔离）
export async function taskKeys(): Promise<string[]> {
  const source = credentialSource();
  if (source === 'env') return [envKey()];
  if (source === 'relay') return [relayConfig().token];
  const { file, master } = await readCredentialFile();
  const entry = providerEntry(file);
  const keys = [open(master, entry.key)];
  const previous = entry.previous;
  if (previous && Date.now() - Date.parse(previous.replacedAt) < CREDENTIALS.previousKeyGraceHours * 3600_000) {
    keys.push(open(master, previous));
  }
  return keys;
}

// 网关地址：relay 模式下换成服务器的转发地址
export function gatewayTarget(): { chatBaseURL: string; imageBaseURL: string; relay: boolean } {
  if (credentialSource() !== 'relay') return { ...GATEWAY, relay: false };
  const { base } = relayConfig();
  return { chatBaseURL: `${base}/v1`, imageBaseURL: base, relay: true };
}

export interface CredentialStatus {
  source: CredentialSource | 'unknown';
  ready: boolean;
  revision?: number; // file 模式下读到的凭据文件版本，后台用它核对两边读的是不是同一份
  reason?: string;
}

// 给 /api/config 和转发的 status 用：不含尾号和密钥
export async function credentialStatus(): Promise<CredentialStatus> {
  let source: CredentialSource;
  try {
    source = credentialSource();
  } catch (e) {
    return { source: 'unknown', ready: false, reason: (e as Error).message };
  }
  if (source === 'env') {
    return process.env.AIHUBMIX_API_KEY?.trim() ? { source, ready: true } : { source, ready: false, reason: '没有配置 AIHUBMIX_API_KEY' };
  }
  if (source === 'relay') {
    try {
      const { base, token } = relayConfig();
      const res = await fetch(`${base}/status`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(CREDENTIALS.relayStatusTimeoutMs),
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as { ready?: unknown; reason?: unknown; error?: { message?: unknown } } | null;
      if (!res.ok) return { source, ready: false, reason: String(body?.error?.message ?? `转发服务器返回 ${res.status}`) };
      return body?.ready === true ? { source, ready: true } : { source, ready: false, reason: String(body?.reason ?? '转发服务器那边不可用') };
    } catch (e) {
      return { source, ready: false, reason: e instanceof NotConfiguredError ? e.message : '连不上转发服务器' };
    }
  }
  let revision: number | undefined;
  try {
    const { file, master } = await readCredentialFile();
    revision = file.revision;
    const entry = providerEntry(file);
    if (entry.status !== 'active') return { source, ready: false, revision, reason: '维护者停用了 AIHubMix key' };
    open(master, entry.key);
    return { source, ready: true, revision };
  } catch (e) {
    return { source, ready: false, ...(revision === undefined ? {} : { revision }), reason: (e as Error).message };
  }
}

// 服务器一侧的转发口令校验：只在 file 模式、后台生成过口令时开放。先比口令再看状态，不给没口令的人透露状态
export async function relayAccess(token: string | null): Promise<'ok' | 'off' | 'denied' | 'disabled'> {
  if (credentialSource() !== 'file') return 'off';
  const { file } = await readCredentialFile();
  if (!file.relay) return 'off';
  if (!token || !tokenMatches(token, file.relay.sha256)) return 'denied';
  return file.relay.status === 'active' ? 'ok' : 'disabled';
}
