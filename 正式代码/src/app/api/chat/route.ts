import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type ModelMessage,
} from 'ai';
import { z } from 'zod';
import { buildInstructions } from '@/agent/instructions';
import { agentTools, type AgentUIMessage, type MessageMeta } from '@/agent/tools';
import { BUDGET } from '@/config/budget';
import { chatModel as findChatModel } from '@/config/models';
import { chatCost } from '@/domain/cost';
import { chatLanguageModel } from '@/server/aihubmix';
import { describeError, errorResponse, GatewayError } from '@/server/errors';
import { reserve, settle } from '@/server/ledger';

const Body = z.object({
  messages: z.array(z.unknown()).min(1).max(400),
  chatModel: z.string(),
  state: z.string().max(20_000),
  photos: z.array(z.string().startsWith('data:image/')).max(6),
});

// 每张缩略图大约折合的输入 token，用于发请求前估价
const PHOTO_TOKENS = 1200;

// 模型调用失败时给用户看的真实原因（AC-11.6：不用固定话术冒充回复）
function chatErrorText(e: unknown): string {
  if (APICallError.isInstance(e)) {
    let code = `http_${e.statusCode ?? '?'}`;
    let msg = e.message;
    try {
      const body = JSON.parse(e.responseBody ?? '{}');
      code = body?.error?.code || code;
      msg = body?.error?.message || msg;
    } catch {
      // 响应不是 JSON 时保留原始信息
    }
    const { error } = describeError(new GatewayError(e.statusCode ?? 502, String(code), msg));
    return `${error.message}（${msg.slice(0, 120)}）`;
  }
  return describeError(e).error.message + (e instanceof Error ? `（${e.message.slice(0, 120)}）` : '');
}

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: { code: 'invalid_request', message: '请求参数不对', detail: parsed.error.message } }, { status: 400 });
    }
    const { chatModel: modelId, state, photos } = parsed.data;
    const model = findChatModel(modelId);
    if (!model) return Response.json({ error: { code: 'unknown_model', message: '没有配置这个对话模型' } }, { status: 400 });

    const valid = await safeValidateUIMessages<AgentUIMessage>({
      messages: parsed.data.messages,
      tools: agentTools,
      dataSchemas: { photos: z.object({ assetIds: z.array(z.string()) }) },
    });
    if (!valid.success) {
      return Response.json({ error: { code: 'invalid_messages', message: '对话记录格式不对', detail: valid.error.message } }, { status: 400 });
    }
    const messages = valid.data;

    // 按字数粗估输入 token（中文约 1 字 1 token），输出按上限算，宁多勿少
    const sentPhotos = model.vision ? photos : [];
    const inputTokens = Math.ceil((JSON.stringify(messages).length + state.length) / 1.5) + sentPhotos.length * PHOTO_TOKENS;
    const estUSD = chatCost(model.pricing, { inputTokens, outputTokens: BUDGET.chat.maxOutputTokens });
    // 预留的估价在调用失败时保留不退：宁可多记，也不让中途失败的调用漏记花费
    const entry = await reserve('chat', model.id, estUSD);

    const photoMessage: ModelMessage[] = sentPhotos.length
      ? [
          {
            role: 'user',
            content: [
              { type: 'text', text: `【系统附上的作品照片，共 ${sentPhotos.length} 张，顺序同作品状态里的照片】` },
              ...sentPhotos.map((p) => ({
                type: 'file' as const,
                mediaType: p.slice(5, p.indexOf(';')),
                data: p.slice(p.indexOf(',') + 1),
              })),
            ],
          },
        ]
      : [];

    const result = streamText({
      model: chatLanguageModel(model.id),
      instructions: buildInstructions(state),
      messages: [...photoMessage, ...(await convertToModelMessages(messages, { tools: agentTools }))],
      tools: agentTools,
      reasoning: model.reasoning,
      maxOutputTokens: BUDGET.chat.maxOutputTokens,
      // 对话超时（PRD 7.3）：模型一直不回时如实报错，界面可重试，不让「正在思考」一直转
      timeout: { totalMs: BUDGET.chat.totalMs, firstChunkMs: BUDGET.chat.firstChunkMs },
      onEnd: async ({ totalUsage }) => {
        await settle(entry.id, chatCost(model.pricing, { inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0 }));
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        messageMetadata: ({ part }): MessageMeta | undefined => {
          // 每次请求开始把花费清零、结束时写本次花费，浏览器在 onFinish 里把它加进作品（技术写法第 2 节）
          if (part.type === 'start') return { model: model.id, modelLabel: model.label, costUSD: 0 };
          if (part.type === 'finish') {
            return {
              costUSD: chatCost(model.pricing, {
                inputTokens: part.totalUsage.inputTokens ?? 0,
                outputTokens: part.totalUsage.outputTokens ?? 0,
              }),
            };
          }
          return undefined;
        },
        onError: chatErrorText,
      }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
