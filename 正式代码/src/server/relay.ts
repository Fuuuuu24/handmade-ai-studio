import 'server-only';
import { BUDGET } from '@/config/budget';
import { CREDENTIALS } from '@/config/credentials';
import { chatModel, GATEWAY, imageEstimate, imageModel } from '@/config/models';
import { chatCost, imageCostCheck } from '@/domain/cost';
import { credentialStatus, gatewayKey, relayAccess, taskKeys } from './credentials';
import { errorResponse } from './errors';
import { attachRef, refund, reserve, settle } from './ledger';
import { redact } from './redact';

/* 协作者转发（技术写法第 12.5 节）：协作者本地的主产品把发往 AIHubMix 的请求发到服务器，凭团队口令，
   服务器换上真 key 再转给 AIHubMix。只在 file 模式、后台生成过口令时开放；只放行 4 个路径加 status。
   模型必须在服务器配置里，沿用单张估价上限和总预算，花费记进服务器账本（via: relay）。不记录请求内容。 */

const ID = '[A-Za-z0-9_-]{1,120}';
const TASK = new RegExp(`^ai/v1/images/(${ID})$`);
const CONTENT = new RegExp(`^ai/v1/images/(${ID})/content/(${ID})$`);

class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });
const onError = (e: unknown) => (e instanceof RelayError ? fail(e.status, e.code, e.message) : errorResponse(e));

async function gate(req: Request): Promise<Response | null> {
  const auth = req.headers.get('authorization') ?? '';
  const access = await relayAccess(auth.startsWith('Bearer ') ? auth.slice(7).trim() : null);
  if (access === 'off') return fail(404, 'relay_off', '服务器没有开放转发');
  if (access === 'denied') return fail(401, 'relay_denied', '团队口令不对');
  if (access === 'disabled') return fail(403, 'relay_disabled', '团队口令已停用');
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') ?? 0) > CREDENTIALS.relayMaxBodyBytes) throw new RelayError(413, 'request_too_large', '请求太大');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > CREDENTIALS.relayMaxBodyBytes) throw new RelayError(413, 'request_too_large', '请求太大');
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(buf));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // 落到下面统一报错
  }
  throw new RelayError(400, 'invalid_request', '请求不是有效的 JSON 对象');
}

// 上游出错：原样转回状态码，正文脱敏
async function passError(res: Response) {
  return new Response(redact(await res.text()), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}

async function chat(req: Request) {
  const body = await readJson(req);
  const model = chatModel(String(body.model ?? ''));
  if (!model) throw new RelayError(400, 'relay_unknown_model', '服务器没有配置这个对话模型');
  const maxOut = Number(body.max_tokens ?? body.max_completion_tokens ?? BUDGET.chat.maxOutputTokens);
  const outputTokens = Number.isFinite(maxOut) && maxOut > 0 ? maxOut : BUDGET.chat.maxOutputTokens;
  // 按字数粗估输入（同 /api/chat），输出按上限算，宁多勿少；失败也不退（同 /api/chat 的做法）
  const inputTokens = Math.ceil(JSON.stringify(body.messages ?? '').length / 1.5);
  const key = await gatewayKey();
  const entry = await reserve('chat', model.id, chatCost(model.pricing, { inputTokens, outputTokens }), 'relay');
  const res = await fetch(`${GATEWAY.chatBaseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BUDGET.chat.totalMs + 15_000),
    cache: 'no-store',
  });
  if (!res.ok) return passError(res);
  const settleUsage = async (usage: unknown) => {
    const u = usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (u) await settle(entry.id, chatCost(model.pricing, { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 }));
  };
  const type = res.headers.get('content-type') ?? '';
  if (!res.body || !type.includes('text/event-stream')) {
    const text = await res.text();
    try {
      await settleUsage(JSON.parse(text).usage);
    } catch {
      // 拿不到用量就按预留的估价记
    }
    return new Response(text, { status: res.status, headers: { 'Content-Type': type || 'application/json' } });
  }
  // 流式回复原样转回，同时从最后一段的 usage 结算；拿不到用量就按预留的估价记
  const decoder = new TextDecoder();
  let pending = '';
  let usage: unknown;
  const scan = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data) as { usage?: unknown };
      if (chunk.usage) usage = chunk.usage;
    } catch {
      // 不是 JSON 的行跳过
    }
  };
  const stream = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(scan);
      },
      async flush() {
        scan(pending + decoder.decode());
        await settleUsage(usage);
      },
    }),
  );
  return new Response(stream, { status: res.status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

async function submitImage(req: Request) {
  const body = await readJson(req);
  const model = imageModel(String(body.model ?? ''));
  if (!model) throw new RelayError(400, 'relay_unknown_model', '服务器没有配置这个生图模型');
  if (body.n !== undefined && body.n !== 1) throw new RelayError(400, 'invalid_request', '每次只能生成一张（每张候选单独一个任务）');
  const refs = Array.isArray(body.images) ? body.images.length : 0;
  if (refs > 8) throw new RelayError(400, 'invalid_request', '参考图最多 8 张');
  const estUSD = imageEstimate(model, refs);
  const cap = imageCostCheck(estUSD, BUDGET.maxImageUSD);
  if (!cap.ok) throw new RelayError(400, 'over_image_cap', cap.reason);
  const key = await gatewayKey();
  const entry = await reserve('image', model.id, estUSD, 'relay');
  const res = await fetch(`${GATEWAY.imageBaseURL}/ai/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  });
  if (!res.ok) {
    // 被网关直接拒绝（4xx）时没有生成，退回预留；5xx 不能确认是否已扣费，保留（同 /api/images）
    if (res.status < 500) await refund(entry.id);
    return passError(res);
  }
  const text = await res.text();
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id;
    if (typeof id === 'string') await attachRef(entry.id, id);
  } catch {
    // 没有任务编号就不挂，花费按估价记
  }
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

// 查询任务、取回结果：任务按创建它的 key 隔离，当前 key 查不到时用替换不满 24 小时的上一把
async function fetchTask(id: string, resultId?: string) {
  const keys = await taskKeys();
  const url = `${GATEWAY.imageBaseURL}/ai/v1/images/${id}${resultId ? `/content/${resultId}` : ''}`;
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${keys[i]}` },
      signal: AbortSignal.timeout(resultId ? 120_000 : 60_000),
      cache: 'no-store',
    });
    if (res.status === 404 && i + 1 < keys.length) {
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) return passError(res);
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
    });
  }
  return fail(404, 'task_not_found', '找不到这个生成任务');
}

export async function relayGet(req: Request, path: string[]): Promise<Response> {
  try {
    const denied = await gate(req);
    if (denied) return denied;
    const joined = path.join('/');
    if (joined === 'status') {
      const s = await credentialStatus();
      return Response.json(s.ready ? { ready: true } : { ready: false, reason: s.reason ?? '服务器的 key 不可用' });
    }
    const task = TASK.exec(joined);
    if (task) return await fetchTask(task[1]);
    const content = CONTENT.exec(joined);
    if (content) return await fetchTask(content[1], content[2]);
    return fail(404, 'relay_path', '这个路径不能转发');
  } catch (e) {
    return onError(e);
  }
}

export async function relayPost(req: Request, path: string[]): Promise<Response> {
  try {
    const denied = await gate(req);
    if (denied) return denied;
    const joined = path.join('/');
    if (joined === 'v1/chat/completions') return await chat(req);
    if (joined === 'ai/v1/images/generations') return await submitImage(req);
    return fail(404, 'relay_path', '这个路径不能转发');
  } catch (e) {
    return onError(e);
  }
}
