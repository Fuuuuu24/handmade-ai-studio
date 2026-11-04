import 'server-only';
import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/* 假对话模型：只给开发和自动化测试用（FAKE_CHAT=1，且不是生产环境），不调用模型、不花钱、不记账。
   按用户最后一句话里的「【测试：xxx】」标记照剧本调用工具；工具结果回来后只回一句固定的话。
   回复都写明是测试，不冒充 AI（开发约定：不把规则回复描述为真实 AI 输出）。 */

export const FAKE_CHAT_LABEL = '测试对话（不是 AI）';

// 标记 → 要调用的工具和参数。一句话里可以带多个标记，按出现顺序调用
export const FAKE_SCRIPT: Record<string, { tool: string; input: Record<string, unknown> }> = {
  信息: {
    tool: 'update_info',
    input: {
      items: [
        { field: 'category', value: '耳饰', note: '测试' },
        { field: 'material', value: '925 银', note: '测试' },
        { field: 'size', value: '长 3cm', note: '测试' },
      ],
    },
  },
  // 核心信息和选填项一起建议：测逐条接受时画布不跳走（BC-002）
  完整信息: {
    tool: 'update_info',
    input: {
      items: [
        { field: 'category', value: '耳饰', note: '测试' },
        { field: 'material', value: '925 银', note: '测试' },
        { field: 'size', value: '长 3cm', note: '测试' },
        { field: 'keep', value: '蝴蝶结的两个圈不能变形', note: '测试' },
        { field: 'price', value: '128 元', note: '测试' },
      ],
    },
  },
  起名: { tool: 'suggest_name', input: { name: '蝴蝶结耳坠', note: '测试' } },
  记录: { tool: 'record_story', input: { kind: 'theme', text: '雨后石阶上的蝴蝶结' } },
  总结: { tool: 'draft_summary', input: { express: '雨后蝴蝶结的安静', feel: '安静、想凑近看', avoid: '太花、道具抢戏' } },
  布景: { tool: 'apply_scene', input: { sceneId: 'tpl-moss' } },
  推荐风格: { tool: 'set_style', input: { items: [{ field: 'light', value: '清冷晨光', basis: 'recommend', reason: '测试：贴合雨后的安静' }] } },
  提示词: {
    tool: 'draft_prompt',
    input: { prompt: '一对手作 925 银蝴蝶结耳坠，严格按参考图还原颜色、数量、轮廓和连接结构，整件完整入框留边距，苔绿手工纸背景，清冷晨光，画面里不要任何文字。' },
  },
  批准: { tool: 'request_approval', input: {} },
  生成: { tool: 'start_generation', input: {} },
  选卡: {
    tool: 'offer_picks',
    input: {
      question: '你更想让顾客感受到哪一种？',
      options: [
        { title: '安静的复古', reason: '深色小石和银线很有旧物感' },
        { title: '轻盈的礼物', reason: '蝴蝶结本身就像包装上的丝带' },
        { title: '利落的日常', reason: '造型小巧，适合每天戴' },
      ],
    },
  },
  意见: { tool: 'note_feedback', input: { round: 1, candidate: 1, issues: ['轮廓'], note: '链子变长了', revise: true } },
  存布景: { tool: 'propose_scene_save', input: { name: '测试布景', reason: '你说这套光线很喜欢' } },
  我的风格: { tool: 'propose_shop_style', input: { fields: ['light', 'tone'], reason: '你说以后都想要这种光线' } },
  导出: { tool: 'offer_export', input: { round: 1, candidate: 2 } },
  补齐: { tool: 'retry_candidate', input: { round: 1, candidate: 1 } },
  后续: { tool: 'note_followup', input: { text: '真人佩戴图' } },
  白底: { tool: 'make_white_asset', input: {} },
  换模型: { tool: 'set_image_model', input: { model: 'gpt-image-2' } },
  比例: { tool: 'set_ratio', input: { ratio: '3:4' } },
};

const MARK = /【测试：([^】]+)】/g;

type Prompt = Parameters<LanguageModelV4['doStream']>[0]['prompt'];

// 「【测试：只想不说】」：只出一段思考就以长度上限结束，用来测回复停在半路时界面的提示和重试（BC-001）
const THINK_ONLY = '【测试：只想不说】';

// 根据对话决定这一步怎么回：工具结果刚回来就收尾；否则按用户最后一句里的标记调用工具
export function fakeTurn(prompt: Prompt): { text: string; calls: { tool: string; input: Record<string, unknown> }[]; thinkOnly?: true } {
  const last = prompt.at(-1);
  if (last?.role === 'tool') return { text: '（测试对话模型）好了，看看右边画布。', calls: [] };
  const user = [...prompt].reverse().find((m) => m.role === 'user');
  const text = user?.role === 'user' ? user.content.map((c) => (c.type === 'text' ? c.text : '')).join('') : '';
  if (text.includes(THINK_ONLY)) return { text: '', calls: [], thinkOnly: true };
  const calls = [...text.matchAll(MARK)].map((m) => FAKE_SCRIPT[m[1]]).filter((c): c is (typeof FAKE_SCRIPT)[string] => !!c);
  if (calls.length) return { text: '', calls };
  return { text: `（测试对话模型，不是 AI）收到：${text.replaceAll(MARK, '').slice(0, 40) || '照片'}`, calls: [] };
}

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };

export function fakeChatModel(): LanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'fake',
    modelId: 'fake-chat',
    doStream: async ({ prompt }) => {
      const turn = fakeTurn(prompt);
      const chunks: LanguageModelV4StreamPart[] = [];
      if (turn.thinkOnly) {
        chunks.push(
          { type: 'reasoning-start', id: 'r' },
          { type: 'reasoning-delta', id: 'r', delta: '（测试对话模型的思考，不是 AI）想了很久还没写答复' },
          { type: 'reasoning-end', id: 'r' },
          { type: 'finish', finishReason: { unified: 'length', raw: 'length' }, usage },
        );
        return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 20 }) };
      }
      if (turn.text) chunks.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: turn.text }, { type: 'text-end', id: 't' });
      turn.calls.forEach((c, i) => chunks.push({ type: 'tool-call', toolCallId: `fake_${Date.now()}_${i}`, toolName: c.tool, input: JSON.stringify(c.input) }));
      chunks.push({ type: 'finish', finishReason: { unified: turn.calls.length ? 'tool-calls' : 'stop', raw: undefined }, usage });
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 20 }) };
    },
  });
}
