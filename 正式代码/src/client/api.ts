import type { Ratio } from '@/config/ratios';

// 调用本站服务端接口。失败时抛出带中文原因的错误，由调用方显示，不吞掉
export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: 'no-store', ...init });
  } catch {
    throw new ApiCallError('network', '连不上服务器，检查网络后再试');
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiCallError(e?.code ?? `http_${res.status}`, e?.message ?? `请求失败（${res.status}）`, e?.detail, res.status);
  }
  return body as T;
}

export interface AppConfig {
  configured: boolean;
  chatModels: { id: string; label: string; vision: boolean }[];
  imageModels: { id: string; label: string; perImageUSD: number }[];
  defaults: { chatModel: string; imageModel: string };
  budget: { spentUSD: number; totalUSD: number; remainingUSD: number };
}

export const fetchConfig = async () => json<AppConfig>(await request('/api/config'));

export interface SubmitResult {
  gatewayId: string;
  status: string;
  estUSD: number;
  ledgerId: string;
}

export async function submitImageTask(body: { model: string; prompt: string; ratio: Ratio; images: string[] }) {
  return json<SubmitResult>(
    await request('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  );
}

export interface TaskStatusResult {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  outputs: number;
  error?: { code: string; message: string; detail?: string };
}

export async function getImageTaskStatus(gatewayId: string, ledgerId?: string) {
  const q = ledgerId ? `?ledger=${encodeURIComponent(ledgerId)}` : '';
  return json<TaskStatusResult>(await request(`/api/images/${encodeURIComponent(gatewayId)}${q}`));
}

export async function downloadImageResult(gatewayId: string, index: number): Promise<Blob> {
  const res = await request(`/api/images/${encodeURIComponent(gatewayId)}/content?i=${index}`);
  if (!res.ok) await json(res);
  return res.blob();
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
