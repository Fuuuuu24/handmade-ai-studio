import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchImageContent, getImageTask } from './aihubmix';
import { emptyCredentialFile, seal } from './credential-file';

const master = randomBytes(32);
const CURRENT = 'sk-current-0123456789abcdCUR1';
const PREVIOUS = 'sk-previous-0123456789abcPRE1';
const ENV_KEYS = ['CREDENTIAL_SOURCE', 'CREDENTIALS_PATH', 'CREDENTIALS_MASTER_KEY', 'MODEL_RELAY_URL', 'MODEL_RELAY_TOKEN'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let dir = '';

const task = (id: string) => ({
  id,
  status: 'completed',
  output: [{ index: 0, b64_json: null, content_url: `https://aihubmix.com/ai/v1/images/${id}/content/result_1` }],
  error: null,
  expires_at: null,
});
const auth = (init?: RequestInit) => (init?.headers as Record<string, string>).Authorization;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yijian-gw-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('查询与取回生图（任务按创建它的 key 隔离）', () => {
  it('当前 key 查不到旧任务时改用上一把，取图也用同一把', async () => {
    process.env.CREDENTIAL_SOURCE = 'file';
    process.env.CREDENTIALS_PATH = path.join(dir, 'credentials.json');
    process.env.CREDENTIALS_MASTER_KEY = master.toString('base64');
    const f = emptyCredentialFile();
    f.providers.aihubmix = {
      status: 'active',
      key: { ...seal(master, 'aihubmix', CURRENT), last4: 'CUR1', savedAt: new Date().toISOString() },
      previous: { ...seal(master, 'aihubmix', PREVIOUS), last4: 'PRE1', replacedAt: new Date().toISOString() },
    };
    writeFileSync(process.env.CREDENTIALS_PATH, JSON.stringify(f));

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (auth(init) !== `Bearer ${PREVIOUS}`) return Response.json({ error: { code: 'task_not_found', message: 'not found' } }, { status: 404 });
      if (String(url).includes('/content/')) return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } });
      return Response.json(task('task_old'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const t = await getImageTask('task_old');
    expect(t.status).toBe('completed');
    expect(fetchMock.mock.calls.map(([, init]) => auth(init))).toEqual([`Bearer ${CURRENT}`, `Bearer ${PREVIOUS}`]);
    const content = await fetchImageContent(t, 0);
    expect(content.mime).toBe('image/jpeg');
    expect(auth(fetchMock.mock.calls[2][1])).toBe(`Bearer ${PREVIOUS}`);
  });

  it('relay 模式下查询和取图都发往服务器的转发地址，带团队口令', async () => {
    process.env.CREDENTIAL_SOURCE = 'relay';
    process.env.MODEL_RELAY_URL = 'https://relay.example.com';
    process.env.MODEL_RELAY_TOKEN = 'team-token-0123456789abcdefghij';
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(async (url) =>
      String(url).includes('/content/') ? new Response(new Uint8Array([0x89, 0x50, 1]), { headers: { 'content-type': 'image/png' } }) : Response.json(task('task_1')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const t = await getImageTask('task_1');
    await fetchImageContent(t, 0);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://relay.example.com/api/relay/aihubmix/ai/v1/images/task_1',
      'https://relay.example.com/api/relay/aihubmix/ai/v1/images/task_1/content/result_1',
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => auth(init) === 'Bearer team-token-0123456789abcdefghij')).toBe(true);
  });
});
