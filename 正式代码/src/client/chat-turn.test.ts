import { describe, expect, it } from 'vitest';
import type { AgentUIMessage, MessageMeta } from '@/agent/tools';
import { turnProblem, withoutLastStep } from './chat-turn';

type Part = AgentUIMessage['parts'][number];

const step: Part = { type: 'step-start' };
const think = (text = '先看照片……But I shouldn’t fabric'): Part => ({ type: 'reasoning', text, state: 'done' });
const say = (text: string): Part => ({ type: 'text', text, state: 'done' });
const recorded = {
  type: 'tool-record_story',
  toolCallId: 'call_1',
  state: 'output-available',
  input: { kind: 'theme', text: '雨后石阶' },
  output: { ok: true, message: '已记下：雨后石阶' },
} as Part;

const reply = (parts: Part[], endReason: MessageMeta['endReason'] = 'stop'): AgentUIMessage => ({
  id: 'msg_1',
  role: 'assistant',
  parts,
  metadata: { endReason },
});

describe('turnProblem：回复停在半路要看得出来（BC-001）', () => {
  it('最后一步只有思考，没有正文也没有操作', () => {
    expect(turnProblem(reply([step, think()]))).toBe('empty');
    // 前几步调用过工具，续轮那一步只想没说，也算没答完
    expect(turnProblem(reply([step, recorded, step, think(), say('  ')]))).toBe('empty');
  });

  it('按结束原因报：服务端超时中止、撞上输出长度上限', () => {
    expect(turnProblem(reply([step, think()], 'timeout'))).toBe('timeout');
    expect(turnProblem(reply([step, think(), say('已按你的意思改好：沿用房')], 'length'))).toBe('length');
    expect(turnProblem(reply([step, think()], 'aborted'))).toBe('aborted');
  });

  it('正常结束：有正文，或者最后一步调用了工具（等结果回来自动续轮）；不是小间的消息不算', () => {
    expect(turnProblem(reply([step, think(), say('照片看清了，先确认资产。')]))).toBeNull();
    expect(turnProblem(reply([step, think(), recorded], 'tool-calls'))).toBeNull();
    expect(turnProblem({ id: 'u', role: 'user', parts: [say('你好')] })).toBeNull();
    expect(turnProblem(undefined)).toBeNull();
  });
});

describe('withoutLastStep：重试只重做最后一步', () => {
  it('前面几步调用过工具：保留它们，去掉没完成的最后一步', () => {
    const kept = withoutLastStep(reply([step, recorded, step, think()]));
    expect(kept?.parts).toEqual([step, recorded]);
    expect(kept?.id).toBe('msg_1');
  });

  it('前面没有调用过工具：整条重来', () => {
    expect(withoutLastStep(reply([step, think()]))).toBeNull();
    expect(withoutLastStep(reply([step, say('上一步只有一句话'), step, think()]))).toBeNull();
  });
});
