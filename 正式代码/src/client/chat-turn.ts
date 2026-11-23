import { isToolUIPart } from 'ai';
import type { AgentUIMessage } from '@/agent/tools';

/* 一轮回复有没有真正结束（BC-001）：服务端超时中止时流里只有 abort，撞到输出长度上限时只是安静地停下，
   界面原本都看不出来，只剩一段思考。这里按消息内容和结束原因判断，界面据此说明原因、可以重试最后一步。 */

export type TurnProblem = 'timeout' | 'aborted' | 'length' | 'empty';

// 最后一步从最后一个 step-start 开始（自动续轮时一条回复里有好几步）
const lastStepStart = (m: AgentUIMessage) => m.parts.findLastIndex((p) => p.type === 'step-start');

// 回复停在半路：超时、被长度上限截断，或者最后一步只有思考、既没有正文也没有操作
export function turnProblem(m: AgentUIMessage | undefined): TurnProblem | null {
  if (m?.role !== 'assistant') return null;
  const end = m.metadata?.endReason;
  if (end === 'timeout' || end === 'aborted' || end === 'length') return end;
  const step = m.parts.slice(lastStepStart(m) + 1);
  return step.some((p) => (p.type === 'text' && p.text.trim() !== '') || isToolUIPart(p)) ? null : 'empty';
}

// 重试最后一步用：前面几步调用过的工具已经改了作品，不能整条重来（会重做一遍）；去掉没完成的最后一步，接着请求。
// 前面没有调用过工具时返回 null，整条回复重来即可
export function withoutLastStep(m: AgentUIMessage): AgentUIMessage | null {
  const kept = m.parts.slice(0, Math.max(0, lastStepStart(m)));
  return kept.some(isToolUIPart) ? { ...m, parts: kept } : null;
}

// 用户在对话里说过的话（核对「你说的」用，BC-013）：浏览器代发的交接和通知不算用户原话（技术写法 13.12）
export const userTextsOf = (messages: readonly AgentUIMessage[]) =>
  messages.filter((m) => m.role === 'user' && !m.metadata?.system).flatMap((m) => m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])));

// 某次工具调用之后用户说过的话（核对同意的原话用，技术写法 14.4）：从含这次调用的那条回复往后数，
// 浏览器代发的交接和通知不算；对话里找不到那次调用时为空
export function userTextsAfterCall(messages: readonly AgentUIMessage[], callId: string): string[] {
  const i = messages.findIndex((m) => m.role === 'assistant' && m.parts.some((p) => isToolUIPart(p) && p.toolCallId === callId));
  return i < 0 ? [] : userTextsOf(messages.slice(i + 1));
}

const settled = new Set(['output-available', 'output-error', 'output-denied']);

// 最后一条回复里有工具调用还没出结果（技术写法 14.5）：不算空闲，交接和通知先不发。
// 工具执行时（比如在等用户点确认框）AI SDK 的状态本来就是「回复中」，这里再兜一层：中途被停下时留下的调用也挡住
export function pendingToolCall(messages: readonly AgentUIMessage[]): boolean {
  const last = messages.at(-1);
  return last?.role === 'assistant' && last.parts.some((p) => isToolUIPart(p) && !settled.has(p.state));
}

// 读出来的对话里没结果的工具调用（页面关掉或中途停下时留下的）：补一条结果，不然下一次请求会因为缺结果出错（技术写法 14.5）。
// 参数还没收全的调用直接去掉；没改动时原样返回
export const DANGLING_OUTPUT = { ok: false, message: '这次调用没有结果（页面关掉或中途停下了），可能没执行；以现在的作品状态为准' };
export function closeDanglingCalls(messages: AgentUIMessage[]): AgentUIMessage[] {
  let touched = false;
  const out = messages.map((m) => {
    if (m.role !== 'assistant' || !m.parts.some((p) => isToolUIPart(p) && !settled.has(p.state))) return m;
    touched = true;
    const parts = m.parts.flatMap((p): AgentUIMessage['parts'] => {
      if (!isToolUIPart(p) || settled.has(p.state)) return [p];
      if (p.state === 'input-streaming') return [];
      return [{ ...p, state: 'output-available', output: DANGLING_OUTPUT } as AgentUIMessage['parts'][number]];
    });
    return { ...m, parts };
  });
  return touched ? out : messages;
}
