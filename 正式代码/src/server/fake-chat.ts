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
  // 用户纠正一处细节，只写「不能改的细节」的建议：测建议没处理时小间写不了提示词（UX-02）、写好提示词后再来建议时的提醒
  纠正细节: { tool: 'update_info', input: { items: [{ field: 'keep', value: '蝴蝶结的两个圈不能变形', note: '测试' }] } },
  起名: { tool: 'rename_work', input: { name: '蝴蝶结耳坠' } },
  记录: { tool: 'record_story', input: { kind: 'theme', text: '雨后石阶上的蝴蝶结' } },
  总结: { tool: 'draft_summary', input: { express: '雨后蝴蝶结的安静', feel: '安静、想凑近看', avoid: '太花、道具抢戏' } },
  推荐风格: { tool: 'set_style', input: { items: [{ field: 'light', value: '清冷晨光', basis: 'recommend', reason: '测试：贴合雨后的安静' }] } },
  // 「你说的」要核对原话（BC-013）：用户这句话里带「平铺」时摆放记为你说的；「冷灰」用户没说过，会被记为小间推荐
  说过平铺: { tool: 'set_style', input: { items: [{ field: 'placement', value: '一对耳饰平铺', basis: 'said', quote: '平铺' }] } },
  误标你说的: { tool: 'set_style', input: { items: [{ field: 'tone', value: '低饱和、偏冷灰', basis: 'said', quote: '冷灰' }] } },
  // 三视图只能提议：放卡片，用户点了才生成
  三视图: { tool: 'propose_views', input: {} },
  重做侧面: { tool: 'propose_views', input: { angles: ['side'], note: '测试：侧面重做一张' } },
  用模板: { tool: 'use_backdrop', input: { backdropId: 'builtin:moss@1' } },
  摆放: {
    tool: 'set_style',
    input: {
      items: [
        { field: 'placement', value: '平铺', basis: 'recommend', reason: '测试' },
        { field: 'composition', value: '主体居中，留白多', basis: 'recommend', reason: '测试' },
      ],
    },
  },
  背景风格: {
    tool: 'set_style',
    input: {
      items: [
        { field: 'tone', value: '雨后苔绿', basis: 'recommend', reason: '测试' },
        { field: 'background', value: '手工纸', basis: 'recommend', reason: '测试' },
        { field: 'light', value: '清冷晨光', basis: 'recommend', reason: '测试' },
      ],
    },
  },
  背景提示词: {
    tool: 'draft_backdrop_prompt',
    input: { prompt: '一张不含任何饰品和文字的电商主图背景：苔绿手工纸，清冷晨光从左上方斜照，画面中下方留出放耳饰的位置。' },
  },
  批准背景: { tool: 'request_approval', input: { kind: 'backdrop' } },
  提示词: {
    tool: 'draft_prompt',
    input: {
      prompt: '第 1 张是背景图，保持它的取景和光线；第 2—4 张是正面、侧面、背面三视图，商品只以三视图为准。一对手作 925 银蝴蝶结耳坠平铺在台面中央，完整入框留边距，画面里不要任何文字。',
    },
  },
  批准: { tool: 'request_approval', input: { kind: 'scene' } },
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
  导出: { tool: 'offer_export', input: { round: 1, candidate: 2 } },
  // 补齐只放卡片，用户点了才补（技术写法 14.6）
  补齐: { tool: 'propose_retry', input: { kind: 'scene', round: 1, candidate: 1 } },
  补齐二: { tool: 'propose_retry', input: { kind: 'scene', round: 1, candidate: 2 } },
  补齐背景: { tool: 'propose_retry', input: { kind: 'backdrop', round: 1, candidate: 1 } },
  后续: { tool: 'note_followup', input: { text: '真人佩戴图' } },
  换模型: { tool: 'set_image_model', input: { model: 'gpt-image-2' } },
  比例: { tool: 'set_ratio', input: { ratio: '3:4' } },
  /* 小间的操作权限（技术写法 14）。用户回「同意」（卡片上的按钮也是发这两个字）时照抄原话代点，见 fakeTurn */
  问三视图: {
    tool: 'ask_confirm',
    input: { items: [{ type: 'confirm_view', angle: 'front' }, { type: 'confirm_view', angle: 'side' }, { type: 'confirm_view', angle: 'back' }] },
  },
  问侧面: { tool: 'ask_confirm', input: { items: [{ type: 'confirm_view', angle: 'side' }] } },
  问信息: {
    tool: 'ask_confirm',
    input: { items: [{ type: 'accept_info', field: 'category' }, { type: 'accept_info', field: 'material' }, { type: 'accept_info', field: 'size' }] },
  },
  问选背景: { tool: 'ask_confirm', input: { items: [{ type: 'pick_backdrop', round: 1, candidate: 1 }, { type: 'save_backdrop', name: '苔绿晨光' }] } },
  问验收: { tool: 'ask_confirm', input: { items: [{ type: 'verdict', round: 1, candidate: 2, real: 'ok', style: 'ok' }] } },
  部分同意: { tool: 'confirm_for_user', input: { quote: '正面和背面可以', only: [1, 3] } },
  推进商品: { tool: 'next_step', input: { step: 'product' } },
  推进信息: { tool: 'next_step', input: { step: 'info' } },
  自己生成: { tool: 'set_backdrop_mode', input: { mode: 'generate' } },
  // 编号由作品状态里取（fakeTurn 换掉 $ 开头的占位）：模板库里最新沉淀的背景图、第一张未分类的照片
  删背景: { tool: 'request_delete', input: { target: 'backdrop', id: '$saved' } },
  删作品: { tool: 'request_delete', input: { target: 'work' } },
  设成正面: { tool: 'set_photo_kind', input: { assetId: '$unsorted', kind: 'front' } },
};

// 剧本里的占位换成作品状态（系统指令末尾）里的编号；找不到就原样留着，执行器会如实拒绝
const PLACEHOLDERS: Record<string, RegExp> = {
  // 模板库列表（agent/state.ts 的 libraryLine）：别的作品沉淀的写「用户沉淀的」，这件作品自己沉淀的写「这件作品第 N 轮背景 M」
  $saved: /[：；](\S+) [^（；：]+（(?:用户沉淀的|这件作品第)/,
  $unsorted: /\d+\. (\S+)（未分类）/,
};
function fill(input: Record<string, unknown>, system: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' && PLACEHOLDERS[v] ? (system.match(PLACEHOLDERS[v])?.[1] ?? v) : v]));
}

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
  // 浏览器代发的交接和通知（技术写法 13.12）：按「我理解的现状 → 还没确认或有矛盾的地方 → 下一步」的结构固定回一句
  const system = text.match(/^【(交接|通知)：([^】]+)】/);
  if (system) {
    return {
      text: `（测试对话模型，不是 AI）我理解的现状：收到「${system[2]}」的${system[1]}。还没确认或有矛盾的地方：这是测试回复，没有检查。下一步：请继续。`,
      calls: [],
    };
  }
  // 用户回「同意」（卡片上的「同意」按钮也是发这两个字）：照抄原话代点
  if (text.replaceAll(MARK, '').trim() === '同意') return { text: '', calls: [{ tool: 'confirm_for_user', input: { quote: '同意' } }] };
  const sys = prompt.find((m) => m.role === 'system');
  const systemText = sys?.role === 'system' ? sys.content : '';
  const calls = [...text.matchAll(MARK)]
    .map((m) => FAKE_SCRIPT[m[1]])
    .filter((c): c is (typeof FAKE_SCRIPT)[string] => !!c)
    .map((c) => ({ ...c, input: fill(c.input, systemText) }));
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
