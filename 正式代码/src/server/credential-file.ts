/* 凭据文件的格式与加解密（技术写法第 12.3 节），主产品和管理后台共用这一份。
   管理后台用 Node 直接加载本文件（类型剥离），所以只依赖 node:crypto、只用可擦除的 TS 写法，
   也不引 server-only（后台的 Node 进程没有 react-server 条件，引了会报错）；浏览器代码引用会因 node:crypto 打包失败。
   主产品经 server/credentials.ts（server-only）只读；只有管理后台写这个文件。 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CREDENTIAL_SCHEMA = 1;
export const PROVIDER_IDS = ['aihubmix'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface SealedSecret {
  iv: string;
  tag: string;
  data: string;
}
export interface StoredKey extends SealedSecret {
  last4: string;
  savedAt: string;
}
export interface PreviousKey extends SealedSecret {
  last4: string;
  replacedAt: string;
}
export interface ProviderEntry {
  status: 'active' | 'disabled';
  key: StoredKey;
  previous: PreviousKey | null; // 替换时换下来的那一把，只用来取回替换前提交的生图
}
export interface RelayEntry {
  status: 'active' | 'disabled';
  sha256: string; // 团队口令只存散列
  last4: string;
  createdAt: string;
}
export interface CredentialLog {
  id: string;
  at: string;
  action: string;
  message: string; // 只写尾号，不写原文
}
export interface CredentialFile {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  providers: Partial<Record<ProviderId, ProviderEntry>>;
  relay: RelayEntry | null;
  log: CredentialLog[];
}

// 附加数据绑定格式版本和供应商：密文挪到别的供应商下会解不开
const aad = (provider: string) => Buffer.from(`yijian-credential:v${CREDENTIAL_SCHEMA}:${provider}`);
const TAG_BYTES = 16;

export function parseMasterKey(raw: string | undefined): Buffer {
  const text = raw?.trim();
  if (!text) throw new Error('没有设置主密钥（CREDENTIALS_MASTER_KEY）');
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32) throw new Error('主密钥（CREDENTIALS_MASTER_KEY）应是 32 字节随机数的 base64，现在长度不对');
  return key;
}

export function seal(master: Buffer, provider: string, plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(provider));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function unseal(master: Buffer, provider: string, box: SealedSecret): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(box.iv, 'base64'), { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(provider));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('解密失败：主密钥不对，或文件被改过');
  }
}

// 录入时的 key 检查；不强制 sk- 前缀
export function normalizeKey(raw: unknown): string {
  const key = String(raw ?? '').trim();
  if (key.length < 16 || key.length > 256) throw new Error('key 长度应在 16—256 个字符之间，请检查是否复制完整');
  if (/[\s\u0000-\u001f\u007f]/.test(key)) throw new Error('key 里不能有空格、换行或控制字符');
  return key;
}

export const lastFour = (secret: string) => secret.slice(-4);
export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
export const newRelayToken = () => randomBytes(32).toString('base64url');

// 定长比较，避免按比较耗时猜口令
export function tokenMatches(token: string, sha256: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(sha256, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function emptyCredentialFile(): CredentialFile {
  return { schemaVersion: CREDENTIAL_SCHEMA, revision: 0, updatedAt: new Date(0).toISOString(), providers: {}, relay: null, log: [] };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isSealed = (v: unknown): v is SealedSecret & Obj => isObj(v) && ['iv', 'tag', 'data'].every((k) => typeof v[k] === 'string');

// 读文件时校验结构：坏文件直接报错，不当成空文件，也不自动修
export function parseCredentialFile(text: string): CredentialFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('凭据文件不是有效的 JSON');
  }
  const bad = (what: string): never => {
    throw new Error(`凭据文件格式不对：${what}`);
  };
  if (!isObj(raw)) return bad('不是对象');
  if (raw.schemaVersion !== CREDENTIAL_SCHEMA) bad(`不认识的版本 ${String(raw.schemaVersion)}`);
  if (!Number.isInteger(raw.revision) || (raw.revision as number) < 0) bad('revision');
  if (typeof raw.updatedAt !== 'string') bad('updatedAt');
  if (!isObj(raw.providers)) return bad('providers');
  for (const [id, entry] of Object.entries(raw.providers)) {
    if (!(PROVIDER_IDS as readonly string[]).includes(id)) bad(`不认识的供应商 ${id}`);
    if (!isObj(entry) || (entry.status !== 'active' && entry.status !== 'disabled')) return bad(`${id}.status`);
    const key = entry.key;
    if (!isSealed(key) || typeof key.last4 !== 'string' || typeof key.savedAt !== 'string') bad(`${id}.key`);
    const prev = entry.previous ?? null;
    if (prev !== null && (!isSealed(prev) || typeof prev.last4 !== 'string' || typeof prev.replacedAt !== 'string')) bad(`${id}.previous`);
    entry.previous = prev;
  }
  const relay = raw.relay ?? null;
  if (
    relay !== null &&
    (!isObj(relay) ||
      (relay.status !== 'active' && relay.status !== 'disabled') ||
      typeof relay.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(relay.sha256) ||
      typeof relay.last4 !== 'string' ||
      typeof relay.createdAt !== 'string')
  )
    bad('relay');
  raw.relay = relay;
  if (!Array.isArray(raw.log)) bad('log');
  return raw as unknown as CredentialFile;
}
