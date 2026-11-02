import 'server-only';
import { redact } from './redact';

// 网关返回的错误：保留原始错误码和信息，便于排查；给用户看的话由 describeGatewayError 转成中文
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly tid?: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

const USER_TEXT: Record<string, string> = {
  insufficient_quota: 'AIHubMix 账户余额不足，需要发起人充值',
  async_not_enabled: 'AIHubMix 账户没有开通异步任务',
  authentication_failed: 'AIHubMix 密钥无效',
  permission_denied: 'AIHubMix 密钥没有权限',
  output_blocked: '生成内容被模型拦截（这次不收费），换个说法或换个模型再试',
  output_policy_violation: '生成内容没通过审核，换个说法再试',
  image_not_generated: '模型没有返回图片，换个模型或调整方案再试',
  upstream_rejected: '模型服务拒绝了这次请求，检查照片和提示词后再试',
  rate_limited: '请求太频繁，稍后再试',
  upstream_rate_limited: '模型服务限流，稍后再试',
  model_unavailable: '这个模型暂时不可用，换一个试试',
  provider_unavailable: '模型服务暂时不可用',
  upstream_unreachable: '模型服务暂时连不上',
  service_unavailable: '网关服务暂时不可用，稍后再试',
  image_too_large: '参考图太大',
  request_too_large: '请求太大（参考图太多或太大）',
  invalid_media_data: '参考图数据损坏',
  unsupported_media_format: '这个模型不支持这种图片格式',
  artifact_expired: '结果已过期（网关只保留 1 小时）',
  too_many_downloads: '这张结果的下载次数已用完',
  doubao_real_person_required: '照片里有真人，Seedream 需要真人认证，换个模型或换一张不含人的照片',
  schema_violation: '参数不符合这个模型的要求',
  capability_not_supported: '这个模型不支持当前参数',
  task_not_found: '找不到这个生成任务',
  result_not_ready: '结果还没准备好',
  model_not_found: '网关上找不到这个模型',
  sync_timeout: '生成超时',
  result_delivery_failed: '结果交付失败',
  internal_error: '网关内部错误',
  // 经服务器转发时（relay 模式，技术写法第 12.5 节）服务器给出的错误
  relay_denied: '团队口令不对，检查 .env.local 里的 MODEL_RELAY_TOKEN',
  relay_disabled: '团队口令已停用，找发起人要新口令',
  relay_off: '服务器没有开放转发',
  relay_path: '服务器不转发这个请求',
  relay_unknown_model: '服务器没有配置这个模型，先在服务器的模型配置里加上',
  budget_exceeded: '服务器上的总预算用完了',
  not_configured: '服务器上的 key 暂时不可用',
};

export interface ApiError {
  code: string;
  message: string; // 给用户看的中文
  detail?: string; // 原始信息，排查用
}

export function describeError(e: unknown): { status: number; error: ApiError } {
  if (e instanceof GatewayError) {
    const text = USER_TEXT[e.code];
    return {
      status: e.status >= 400 && e.status < 600 ? e.status : 502,
      error: { code: e.code, message: text ?? `模型服务出错（${e.code}）`, detail: redact([e.message, e.tid].filter(Boolean).join(' · ')) },
    };
  }
  if (e instanceof BudgetError) return { status: 402, error: { code: 'budget_exceeded', message: e.message } };
  if (e instanceof NotConfiguredError) return { status: 503, error: { code: 'not_configured', message: e.message } };
  const msg = e instanceof Error ? e.message : String(e);
  return { status: 500, error: { code: 'server_error', message: '服务端出错', detail: redact(msg) } };
}

export const errorResponse = (e: unknown) => {
  const { status, error } = describeError(e);
  return Response.json({ error }, { status });
};
