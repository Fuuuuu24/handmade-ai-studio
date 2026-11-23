import { describe, expect, it } from 'vitest';
import type { AgentUIMessage, MessageMeta } from '@/agent/tools';
import { closeDanglingCalls, DANGLING_OUTPUT, pendingToolCall, turnProblem, userTextsAfterCall, userTextsOf, withoutLastStep } from './chat-turn';

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

describe('userTextsOf：核对「你说的」只看用户原话（技术写法 13.12）', () => {
  it('浏览器代发的交接和通知不算', () => {
    expect(userTextsOf([user('想要平铺'), user('【交接：摆放】摆放：平铺', 'handoff'), user('【通知：候选】…', 'notice')])).toEqual(['想要平铺']);
  });
});

const user = (text: string, system?: 'handoff' | 'notice') =>
  ({ id: text, role: 'user', metadata: system ? { system } : undefined, parts: [{ type: 'text', text }] }) as AgentUIMessage;
const asking = { type: 'tool-ask_confirm', toolCallId: 'call_ask', state: 'output-available', input: { items: [] }, output: { ok: true, message: '卡片已放出' } } as Part;
const waiting = { type: 'tool-request_delete', toolCallId: 'call_del', state: 'input-available', input: { target: 'work' } } as Part;

describe('userTextsAfterCall：同意的原话只认问过之后用户说的（技术写法 14.4）', () => {
  it('从问的那条回复往后数；问之前说的、系统代发的都不算；找不到那次调用时为空', () => {
    const list = [user('帮我把三视图确认了'), reply([step, asking]), user('【通知：三视图】…', 'notice'), user('同意')];
    expect(userTextsAfterCall(list, 'call_ask')).toEqual(['同意']);
    expect(userTextsAfterCall(list.slice(0, 2), 'call_ask')).toEqual([]);
    expect(userTextsAfterCall(list, 'call_nope')).toEqual([]);
  });
});

describe('工具调用还没出结果（技术写法 14.5）', () => {
  it('最后一条回复里有没结果的调用：不算空闲', () => {
    expect(pendingToolCall([user('删掉吧'), reply([step, waiting])])).toBe(true);
    expect(pendingToolCall([user('删掉吧'), reply([step, recorded])])).toBe(false);
    expect(pendingToolCall([user('你好')])).toBe(false);
  });

  it('读出来时补上结果；参数没收全的去掉；没有要补的原样返回', () => {
    const streaming = { type: 'tool-rename_work', toolCallId: 'call_name', state: 'input-streaming', input: undefined } as Part;
    const list = [user('删掉吧'), reply([step, recorded, waiting, streaming])];
    const fixed = closeDanglingCalls(list);
    expect(fixed[1].parts).toEqual([step, recorded, { ...waiting, state: 'output-available', output: DANGLING_OUTPUT }]);
    expect(pendingToolCall(fixed)).toBe(false);
    const fine = [user('你好'), reply([step, recorded])];
    expect(closeDanglingCalls(fine)).toBe(fine);
  });
});
