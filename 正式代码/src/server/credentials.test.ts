import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCredentialFile, hashToken, seal, type CredentialFile } from './credential-file';
import { credentialStatus, gatewayKey, gatewayTarget, relayAccess, taskKeys } from './credentials';
import { NotConfiguredError } from './errors';
import { redact } from './redact';

const master = randomBytes(32);
const CURRENT = 'sk-current-0123456789abcdCUR1';
const PREVIOUS = 'sk-previous-0123456789abcPRE1';
const TOKEN = 'team-token-0123456789abcdefghijTOK1';
const ENV_KEYS = ['CREDENTIAL_SOURCE', 'CREDENTIALS_PATH', 'CREDENTIALS_MASTER_KEY', 'AIHUBMIX_API_KEY', 'MODEL_RELAY_URL', 'MODEL_RELAY_TOKEN'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let dir = '';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function writeCreds(patch: (f: CredentialFile) => void = () => {}, key = CURRENT) {
  const f = emptyCredentialFile();
  f.revision = 3;
  f.providers.aihubmix = { status: 'active', key: { ...seal(master, 'aihubmix', key), last4: key.slice(-4), savedAt: hoursAgo(1) }, previous: null };
  patch(f);
  writeFileSync(process.env.CREDENTIALS_PATH!, JSON.stringify(f));
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  dir = mkdtempSync(path.join(tmpdir(), 'yijian-cred-'));
  process.env.CREDENTIAL_SOURCE = 'file';
  process.env.CREDENTIALS_PATH = path.join(dir, 'credentials.json');
  process.env.CREDENTIALS_MASTER_KEY = master.toString('base64');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('凭据来源 env（不设 CREDENTIAL_SOURCE 时的默认，和以前一样）', () => {
  it('读 AIHUBMIX_API_KEY；没配置时报可读的错', async () => {
    delete process.env.CREDENTIAL_SOURCE;
    process.env.AIHUBMIX_API_KEY = CURRENT;
    expect(await gatewayKey()).toBe(CURRENT);
    expect(await taskKeys()).toEqual([CURRENT]);
    expect(await credentialStatus()).toEqual({ source: 'env', ready: true });
    delete process.env.AIHUBMIX_API_KEY;
    await expect(gatewayKey()).rejects.toBeInstanceOf(NotConfiguredError);
    expect((await credentialStatus()).ready).toBe(false);
  });

  it('CREDENTIAL_SOURCE 写错时报错，不猜', async () => {
    process.env.CREDENTIAL_SOURCE = 'files';
    await expect(gatewayKey()).rejects.toThrow('只能是 env、file 或 relay');
    expect(await credentialStatus()).toMatchObject({ source: 'unknown', ready: false });
  });
});

describe('凭据来源 file（技术写法第 12.4 节）', () => {
  it('启用时新请求用当前 key，状态带文件版本', async () => {
    writeCreds();
    expect(await gatewayKey()).toBe(CURRENT);
    expect(await credentialStatus()).toEqual({ source: 'file', ready: true, revision: 3 });
  });

  it('每次调用现读文件：后台换了 key，下一次就用新的', async () => {
    writeCreds();
    expect(await gatewayKey()).toBe(CURRENT);
    writeCreds(() => {}, PREVIOUS);
    expect(await gatewayKey()).toBe(PREVIOUS);
  });

  it('停用后拒绝新请求，但查询和取回已提交的生图照常', async () => {
    writeCreds((f) => (f.providers.aihubmix!.status = 'disabled'));
    await expect(gatewayKey()).rejects.toThrow('已被维护者停用');
    expect(await taskKeys()).toEqual([CURRENT]);
    expect(await credentialStatus()).toMatchObject({ ready: false, revision: 3, reason: '维护者停用了 AIHubMix key' });
  });

  it('上一把 key 在 24 小时内跟在当前 key 后面，过期就不再用', async () => {
    const previous = (replacedAt: string) => ({ ...seal(master, 'aihubmix', PREVIOUS), last4: 'PRE1', replacedAt });
    writeCreds((f) => (f.providers.aihubmix!.previous = previous(hoursAgo(23))));
    expect(await taskKeys()).toEqual([CURRENT, PREVIOUS]);
    writeCreds((f) => (f.providers.aihubmix!.previous = previous(hoursAgo(25))));
    expect(await taskKeys()).toEqual([CURRENT]);
  });

  it('出问题时报错，不回退到环境变量', async () => {
    process.env.AIHUBMIX_API_KEY = 'sk-env-should-not-be-used-1234';
    await expect(gatewayKey()).rejects.toThrow('凭据文件不存在');
    writeFileSync(process.env.CREDENTIALS_PATH!, '{坏了');
    await expect(gatewayKey()).rejects.toThrow('不是有效的 JSON');
    writeCreds((f) => delete f.providers.aihubmix);
    await expect(gatewayKey()).rejects.toThrow('还没有在管理后台配置 AIHubMix key');
    writeCreds();
    process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString('base64');
    await expect(gatewayKey()).rejects.toThrow('解密失败');
    expect(await credentialStatus()).toMatchObject({ source: 'file', ready: false, revision: 3 });
    delete process.env.CREDENTIALS_MASTER_KEY;
    await expect(gatewayKey()).rejects.toThrow('没有设置主密钥');
    delete process.env.CREDENTIALS_PATH;
    await expect(gatewayKey()).rejects.toThrow('CREDENTIALS_PATH');
  });

  it('用过的 key 会被脱敏，错误文字里只剩尾号', async () => {
    writeCreds();
    await gatewayKey();
    const text = redact(`Invalid key ${CURRENT}; header Bearer ${CURRENT}; other sk-abcdefghij123456`);
    expect(text).not.toContain(CURRENT);
    expect(text).not.toContain('sk-abcdefghij123456');
    expect(text).toContain('尾号 CUR1');
  });
});

describe('协作者转发（技术写法第 12.5 节）', () => {
  it('服务器一侧：没生成口令时不开放；先比口令再看状态', async () => {
    writeCreds();
    expect(await relayAccess(TOKEN)).toBe('off');
    const relay = (status: 'active' | 'disabled') => ({ status, sha256: hashToken(TOKEN), last4: 'TOK1', createdAt: hoursAgo(1) });
    writeCreds((f) => (f.relay = relay('active')));
    expect(await relayAccess(TOKEN)).toBe('ok');
    expect(await relayAccess('wrong')).toBe('denied');
    expect(await relayAccess(null)).toBe('denied');
    writeCreds((f) => (f.relay = relay('disabled')));
    expect(await relayAccess('wrong')).toBe('denied');
    expect(await relayAccess(TOKEN)).toBe('disabled');
    process.env.CREDENTIAL_SOURCE = 'env';
    expect(await relayAccess(TOKEN)).toBe('off');
  });

  it('协作者本地：只填服务器地址，转发路径按供应商拼上；凭据换成团队口令；只认 https 或本机 http', async () => {
    process.env.CREDENTIAL_SOURCE = 'relay';
    process.env.MODEL_RELAY_URL = 'https://relay.example.com/';
    process.env.MODEL_RELAY_TOKEN = TOKEN;
    expect(gatewayTarget()).toEqual({
      chatBaseURL: 'https://relay.example.com/api/relay/aihubmix/v1',
      imageBaseURL: 'https://relay.example.com/api/relay/aihubmix',
      relay: true,
    });
    expect(await gatewayKey()).toBe(TOKEN);
    expect(await taskKeys()).toEqual([TOKEN]);
    process.env.MODEL_RELAY_URL = 'https://relay.example.com/api/relay/aihubmix';
    expect(() => gatewayTarget()).toThrow('只填服务器地址');
    process.env.MODEL_RELAY_URL = 'https://relay.example.com/?x=1';
    expect(() => gatewayTarget()).toThrow('只填服务器地址');
    process.env.MODEL_RELAY_URL = 'http://relay.example.com';
    expect(() => gatewayTarget()).toThrow('https');
    process.env.MODEL_RELAY_URL = 'http://127.0.0.1:3000';
    expect(gatewayTarget().imageBaseURL).toBe('http://127.0.0.1:3000/api/relay/aihubmix');
    delete process.env.MODEL_RELAY_TOKEN;
    await expect(gatewayKey()).rejects.toThrow('MODEL_RELAY_TOKEN');
  });

  it('协作者本地的状态如实反映服务器那边', async () => {
    process.env.CREDENTIAL_SOURCE = 'relay';
    process.env.MODEL_RELAY_URL = 'https://relay.example.com';
    process.env.MODEL_RELAY_TOKEN = TOKEN;
    const fetchMock = vi.fn(async () => Response.json({ ready: false, reason: '维护者停用了 AIHubMix key' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await credentialStatus()).toEqual({ source: 'relay', ready: false, reason: '维护者停用了 AIHubMix key' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay.example.com/api/relay/aihubmix/status');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'relay_denied', message: '团队口令不对' } }, { status: 401 })));
    expect(await credentialStatus()).toEqual({ source: 'relay', ready: false, reason: '团队口令不对' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    expect(await credentialStatus()).toEqual({ source: 'relay', ready: false, reason: '连不上转发服务器' });
  });
});
