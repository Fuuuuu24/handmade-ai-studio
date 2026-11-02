import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatModel } from '@/config/models';
import { chatCost } from '@/domain/cost';
import { emptyCredentialFile, hashToken, seal, type CredentialFile } from './credential-file';
import { relayGet, relayPost } from './relay';

const master = randomBytes(32);
const CURRENT = 'sk-current-0123456789abcdCUR1';
const PREVIOUS = 'sk-previous-0123456789abcPRE1';
const TOKEN = 'team-token-0123456789abcdefghijTOK1';
const ENV_KEYS = ['CREDENTIAL_SOURCE', 'CREDENTIALS_PATH', 'CREDENTIALS_MASTER_KEY', 'LEDGER_PATH'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let dir = '';

type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;
const auth = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization;
const ledger = () => JSON.parse(readFileSync(process.env.LEDGER_PATH!, 'utf8')).entries as { kind: string; status: string; estUSD: number; actualUSD?: number; via?: string; ref?: string }[];

function writeCreds(patch: (f: CredentialFile) => void = () => {}) {
  const f = emptyCredentialFile();
  f.revision = 5;
  f.providers.aihubmix = {
    status: 'active',
    key: { ...seal(master, 'aihubmix', CURRENT), last4: 'CUR1', savedAt: new Date().toISOString() },
    previous: { ...seal(master, 'aihubmix', PREVIOUS), last4: 'PRE1', replacedAt: new Date().toISOString() },
  };
  f.relay = { status: 'active', sha256: hashToken(TOKEN), last4: 'TOK1', createdAt: new Date().toISOString() };
  patch(f);
  writeFileSync(process.env.CREDENTIALS_PATH!, JSON.stringify(f));
}

const req = (method: string, body?: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}) =>
  new Request('http://127.0.0.1/api/relay/aihubmix/x', {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

function stubFetch(fn: FetchFn) {
  const mock = vi.fn<FetchFn>(fn);
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yijian-relay-'));
  process.env.CREDENTIAL_SOURCE = 'file';
  process.env.CREDENTIALS_PATH = path.join(dir, 'credentials.json');
  process.env.CREDENTIALS_MASTER_KEY = master.toString('base64');
  process.env.LEDGER_PATH = path.join(dir, 'ledger.json');
  writeCreds();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('转发入口（技术写法第 12.5 节）', () => {
  it('没口令、口令错、口令停用、没生成口令、不是 file 模式都不放行，也不调用上游', async () => {
    const upstream = stubFetch(async () => Response.json({}));
    expect((await relayGet(req('GET', undefined, null), ['status'])).status).toBe(401);
    expect((await relayGet(req('GET', undefined, 'wrong'), ['status'])).status).toBe(401);
    writeCreds((f) => (f.relay!.status = 'disabled'));
    expect((await relayGet(req('GET'), ['status'])).status).toBe(403);
    writeCreds((f) => (f.relay = null));
    const off = await relayGet(req('GET'), ['status']);
    expect(off.status).toBe(404);
    expect((await off.json()).error.code).toBe('relay_off');
    writeCreds();
    process.env.CREDENTIAL_SOURCE = 'env';
    expect((await relayPost(req('POST', { model: 'qwen3.8-flash' }), ['v1', 'chat', 'completions'])).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('status 如实说明服务器的 key 能不能用', async () => {
    expect(await (await relayGet(req('GET'), ['status'])).json()).toEqual({ ready: true });
    writeCreds((f) => (f.providers.aihubmix!.status = 'disabled'));
    expect(await (await relayGet(req('GET'), ['status'])).json()).toEqual({ ready: false, reason: '维护者停用了 AIHubMix key' });
  });

  it('只放行 4 个路径加 status', async () => {
    const upstream = stubFetch(async () => Response.json({}));
    for (const p of [['ai', 'v1', 'models'], ['ai', 'v1', 'images', '..', 'x'], ['v1', 'chat', 'completions']]) {
      const res = await relayGet(req('GET'), p);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('relay_path');
    }
    expect((await relayPost(req('POST', {}), ['v1', 'embeddings'])).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('转发对话', () => {
  it('不在服务器配置里的模型拒绝，不记账', async () => {
    const upstream = stubFetch(async () => Response.json({}));
    const res = await relayPost(req('POST', { model: 'gpt-5-pro', messages: [] }), ['v1', 'chat', 'completions']);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('relay_unknown_model');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('换上真 key 转给 AIHubMix，流式原样转回，按返回的用量记账（via relay）', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":200}}\n\n',
      'data: [DONE]\n\n',
    ];
    const upstream = stubFetch(async () => new Response(sse.join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const res = await relayPost(req('POST', { model: 'qwen3.8-flash', stream: true, messages: [{ role: 'user', content: 'hi' }] }), ['v1', 'chat', 'completions']);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(sse.join(''));
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe('https://aihubmix.com/v1/chat/completions');
    expect(auth(init)).toBe(`Bearer ${CURRENT}`);
    const [entry] = ledger();
    expect(entry).toMatchObject({ kind: 'chat', status: 'settled', via: 'relay' });
    expect(entry.actualUSD).toBeCloseTo(chatCost(chatModel('qwen3.8-flash')!.pricing, { inputTokens: 1000, outputTokens: 200 }), 12);
  });

  it('上游报错原样转回状态码，正文里的 key 被脱敏', async () => {
    stubFetch(async () => Response.json({ error: { code: 'authentication_failed', message: `bad key ${CURRENT}` } }, { status: 401 }));
    const res = await relayPost(req('POST', { model: 'qwen3.8-flash', messages: [] }), ['v1', 'chat', 'completions']);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain(CURRENT);
    expect(text).toContain('authentication_failed');
  });

  it('服务器的 key 停用时拒绝新请求，不记账', async () => {
    writeCreds((f) => (f.providers.aihubmix!.status = 'disabled'));
    const upstream = stubFetch(async () => Response.json({}));
    const res = await relayPost(req('POST', { model: 'qwen3.8-flash', messages: [] }), ['v1', 'chat', 'completions']);
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('请求体超过上限直接拒绝', async () => {
    const res = await relayPost(req('POST', { model: 'qwen3.8-flash' }, TOKEN, { 'content-length': String(64 * 1024 * 1024) }), ['v1', 'chat', 'completions']);
    expect(res.status).toBe(413);
  });
});

describe('转发生图', () => {
  it('一次只能一张；成功后挂上任务编号，4xx 退回预留', async () => {
    expect((await relayPost(req('POST', { model: 'doubao-seedream-5.0-lite', prompt: 'p', n: 2 }), ['ai', 'v1', 'images', 'generations'])).status).toBe(400);
    stubFetch(async () => Response.json({ id: 'task_9', status: 'pending', output: [] }));
    const ok = await relayPost(req('POST', { model: 'doubao-seedream-5.0-lite', prompt: 'p', n: 1, async: true }), ['ai', 'v1', 'images', 'generations']);
    expect(ok.status).toBe(200);
    expect(ledger()[0]).toMatchObject({ kind: 'image', status: 'reserved', via: 'relay', ref: 'task_9' });
    stubFetch(async () => Response.json({ error: { code: 'upstream_rejected', message: 'no' } }, { status: 400 }));
    const rejected = await relayPost(req('POST', { model: 'doubao-seedream-5.0-lite', prompt: 'p' }), ['ai', 'v1', 'images', 'generations']);
    expect(rejected.status).toBe(400);
    expect(ledger()[1]).toMatchObject({ status: 'refunded', via: 'relay' });
  });

  it('查询和取图：当前 key 查不到时用上一把', async () => {
    const upstream = stubFetch(async (url, init) => {
      if (auth(init) !== `Bearer ${PREVIOUS}`) return Response.json({ error: { code: 'task_not_found', message: 'nf' } }, { status: 404 });
      return String(url).includes('/content/') ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }) : Response.json({ id: 'task_old', status: 'completed' });
    });
    const task = await relayGet(req('GET'), ['ai', 'v1', 'images', 'task_old']);
    expect(await task.json()).toEqual({ id: 'task_old', status: 'completed' });
    const content = await relayGet(req('GET'), ['ai', 'v1', 'images', 'task_old', 'content', 'result_1']);
    expect(content.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(upstream.mock.calls.map(([u]) => String(u))).toEqual([
      'https://aihubmix.com/ai/v1/images/task_old',
      'https://aihubmix.com/ai/v1/images/task_old',
      'https://aihubmix.com/ai/v1/images/task_old/content/result_1',
      'https://aihubmix.com/ai/v1/images/task_old/content/result_1',
    ]);
  });
});
