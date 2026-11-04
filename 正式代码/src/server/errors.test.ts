import { APICallError, simulateReadableStream, streamText, toUIMessageStream, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { agentTools } from '@/agent/tools';
import { chatErrorText } from './errors';

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };

// 走一遍真实的 AI SDK 流：模型发出一个工具调用，看界面和模型收到的错误文字
async function toolErrorTexts(toolName: string, input: unknown): Promise<string[]> {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'tool-call', toolCallId: 'call_1', toolName, input: JSON.stringify(input) },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
        ],
      }),
    }),
  });
  const result = streamText({ model, tools: agentTools, messages: [{ role: 'user', content: '写提示词' }] });
  const out: string[] = [];
  const reader = toUIMessageStream({ stream: result.stream, onError: chatErrorText }).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    const chunk = value as UIMessageChunk;
    if ('errorText' in chunk && typeof chunk.errorText === 'string') out.push(chunk.errorText);
  }
}

describe('chatErrorText：对话流里的错误要带上真实原因', () => {
  it('工具参数多包了一层 arguments：说明是参数格式问题和哪一项不对，两次错误文字都不丢原因（BC-004）', async () => {
    const texts = await toolErrorTexts('draft_prompt', { arguments: { prompt: '一件手作项链，按参考图还原颜色、数量、轮廓和连接结构。' } });
    // AI SDK 先发 tool-input-error（错误对象），再发 tool-output-error（错误文字），后一个会覆盖界面上的文字
    expect(texts).toHaveLength(2);
    for (const t of texts) {
      expect(t).toMatch(/^工具参数格式不对（draft_prompt · prompt：/);
      expect(t).not.toContain('服务端出错');
    }
  });

  it('调用不存在的工具：写明工具名', async () => {
    const texts = await toolErrorTexts('approve_plan', {});
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toBe('调用了不存在的工具（approve_plan）');
  });

  it('其他错误：Error 和文字都附上原文；网关错误转成中文并附原文', () => {
    expect(chatErrorText(new Error('boom'))).toBe('服务端出错（boom）');
    expect(chatErrorText('stream closed')).toBe('服务端出错（stream closed）');
    const api = new APICallError({
      message: 'Too Many Requests',
      url: 'https://aihubmix.com/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 429,
      responseBody: JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }),
    });
    expect(chatErrorText(api)).toBe('请求太频繁，稍后再试（slow down）');
  });
});
