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
