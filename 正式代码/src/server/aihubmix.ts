import 'server-only';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { GATEWAY, type ImageModel } from '@/config/models';
import type { Ratio } from '@/config/ratios';
import { gatewayKey, gatewayTarget, taskKeys } from './credentials';
import { GatewayError } from './errors';

/* AIHubMix 网关：对话走 OpenAI 兼容接口，生图走原生图片协议 /ai/v1/images（异步任务）。
   接口说明见 https://docs.aihubmix.com/cn/api/aihubmix-image-generation
   key 和地址按凭据来源取（server/credentials.ts）；relay 模式下请求发往服务器的转发接口。 */

let provider: ReturnType<typeof createOpenAICompatible> | null = null;

export function chatLanguageModel(id: string) {
  // key 每次请求现取（AI SDK 会在每次请求时调用这个函数），后台换 key 后下一个请求就用新的
  provider ??= createOpenAICompatible({ name: 'aihubmix', baseURL: gatewayTarget().chatBaseURL, apiKey: () => gatewayKey(), includeUsage: true });
  return provider(id);
}

export type GatewayTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface GatewayImageTask {
  id: string;
  status: GatewayTaskStatus;
  output: { index: number; b64_json: string | null; content_url: string | null }[];
  error: { code?: string; message?: string } | null;
  expires_at: number | null;
}

const TASK_ID = /^[A-Za-z0-9_-]{1,120}$/;
export const validTaskId = (id: string) => TASK_ID.test(id);

async function call(pathname: string, init: RequestInit = {}, key?: string): Promise<unknown> {
  const res = await fetch(`${gatewayTarget().imageBaseURL}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${key ?? (await gatewayKey())}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  });
  const text = await res.text();
  let body: { error?: { code?: string; message?: string; tid?: string } } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new GatewayError(res.status, err.code ?? `http_${res.status}`, err.message ?? text.slice(0, 300), err.tid);
  }
  if (!body) throw new GatewayError(502, 'bad_response', `网关返回的内容不是 JSON：${text.slice(0, 120)}`);
  return body;
}

function parseTask(raw: unknown): GatewayImageTask {
  const t = raw as Partial<GatewayImageTask>;
  if (!t || typeof t.id !== 'string' || typeof t.status !== 'string') {
    throw new GatewayError(502, 'bad_response', '网关返回的任务格式不对');
  }
  return { id: t.id, status: t.status, output: t.output ?? [], error: t.error ?? null, expires_at: t.expires_at ?? null };
}

export interface ImageInput {
  prompt: string;
  ratio: Ratio;
  images: string[]; // data URI
}

// 各模型的尺寸参数不同（有的用比例，有的用像素），统一在 config/models.ts 里配置
export function imageRequestBody(model: ImageModel, input: ImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model: model.id, prompt: input.prompt, n: 1, async: true };
  if (model.sizing.kind === 'aspect_ratio') {
    body.aspect_ratio = input.ratio;
    if (model.sizing.resolution) body.resolution = model.sizing.resolution;
  } else {
    body.size = model.sizing.sizes[input.ratio];
  }
  if (input.images.length) body.images = input.images;
  if (model.outputFormat) body.output_format = model.outputFormat;
  if (model.extra) body.extra = model.extra;
  return body;
}

export async function submitImage(model: ImageModel, input: ImageInput) {
  return parseTask(await call('/ai/v1/images/generations', { method: 'POST', body: JSON.stringify(imageRequestBody(model, input)) }));
}

// 查到任务时用的是哪把 key：取图要用同一把
const taskKey = new WeakMap<GatewayImageTask, string>();

export async function getImageTask(id: string) {
  if (!validTaskId(id)) throw new GatewayError(400, 'invalid_task_id', '任务编号格式不对');
  const keys = await taskKeys();
  for (let i = 0; ; i++) {
    try {
      const task = parseTask(await call(`/ai/v1/images/${encodeURIComponent(id)}`, { method: 'GET' }, keys[i]));
      taskKey.set(task, keys[i]);
      return task;
    } catch (e) {
      // AIHubMix 的任务按创建它的 key 隔离：后台替换 key 后，旧任务改用替换不满 24 小时的上一把再查一次
      if (i + 1 < keys.length && e instanceof GatewayError && e.status === 404) continue;
      throw e;
    }
  }
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x52 && bytes[8] === 0x57) return 'image/webp';
  return 'application/octet-stream';
}

// 取回结果图片。网关结果只保留 1 小时、下载次数有限，浏览器拿到后要立刻存下
export async function fetchImageContent(task: GatewayImageTask, index: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const out = task.output.find((o) => o.index === index);
  if (!out) throw new GatewayError(404, 'result_not_found', `任务里没有第 ${index + 1} 张结果`);
  if (out.b64_json) {
    const bytes = Uint8Array.from(Buffer.from(out.b64_json, 'base64'));
    return { bytes, mime: sniffMime(bytes) };
  }
  if (!out.content_url) throw new GatewayError(502, 'bad_response', '结果没有图片地址');
  const url = new URL(out.content_url);
  if (url.origin !== GATEWAY.imageBaseURL) throw new GatewayError(502, 'bad_response', '结果地址不是网关域名，已拒绝下载');
  // relay 模式下结果地址换成服务器的转发地址
  const target = gatewayTarget();
  const href = target.relay ? `${target.imageBaseURL}${url.pathname}${url.search}` : url.href;
  const key = taskKey.get(task) ?? (await taskKeys())[0];
  const res = await fetch(href, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120_000), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    let err: { code?: string; message?: string; tid?: string } = {};
    try {
      err = JSON.parse(text).error ?? {};
    } catch {
      // 不是 JSON 就用原文
    }
    throw new GatewayError(res.status, err.code ?? `http_${res.status}`, err.message ?? text.slice(0, 200), err.tid);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  return { bytes, mime: type.startsWith('image/') ? type.split(';')[0] : sniffMime(bytes) };
}
