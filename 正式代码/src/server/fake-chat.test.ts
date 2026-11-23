import { describe, expect, it } from 'vitest';
import { agentTools } from '@/agent/tools';
import { FAKE_SCRIPT, fakeTurn } from './fake-chat';

const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] });

describe('假对话模型（只给开发和测试用）', () => {
  it('按标记照剧本调用工具，多个标记按顺序', () => {
    expect(fakeTurn([user('好的【测试：信息】【测试：总结】')]).calls.map((c) => c.tool)).toEqual(['update_info', 'draft_summary']);
  });

  it('没有标记时如实说明是测试回复；工具结果回来后收尾', () => {
    expect(fakeTurn([user('你好')]).text).toContain('不是 AI');
    expect(fakeTurn([user('【测试：信息】'), { role: 'tool', content: [] }])).toEqual({ text: expect.stringContaining('测试对话模型'), calls: [] });
  });

  it('浏览器代发的交接和通知：按结构回一句，不调用工具（技术写法 13.12）', () => {
    const turn = fakeTurn([user('【交接：商品】用户点了「下一步」…')]);
    expect(turn.calls).toEqual([]);
    expect(turn.text).toContain('我理解的现状：收到「商品」的交接');
    expect(turn.text).toContain('下一步：');
  });

  it('「只想不说」只出思考，不调用工具、不写正文（测回复停在半路的提示，BC-001）', () => {
    expect(fakeTurn([user('继续【测试：只想不说】')])).toEqual({ text: '', calls: [], thinkOnly: true });
  });

  it('剧本里每个工具调用都符合工具的参数格式', async () => {
    for (const [mark, { tool, input }] of Object.entries(FAKE_SCRIPT)) {
      const def = agentTools[tool as keyof typeof agentTools];
      expect(def, mark).toBeTruthy();
      const schema = def.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
      expect(schema.safeParse(input).success, mark).toBe(true);
    }
  });

  it('用户回「同意」时照抄原话代点；占位编号从作品状态里取（技术写法 14）', () => {
    expect(fakeTurn([user('同意')]).calls).toEqual([{ tool: 'confirm_for_user', input: { quote: '同意' } }]);
    const system = { role: 'system' as const, content: '照片编号：1. asset_a（正面）；2. asset_b（未分类）\n模板库里可选的背景图（use_backdrop 用编号）：bd_x 苔绿晨光（用户沉淀的；色调「苔绿」）；builtin:moss@1 雨后清晨（内置模板）' };
    expect(fakeTurn([system, user('删掉它【测试：删背景】')]).calls).toEqual([{ tool: 'request_delete', input: { target: 'backdrop', id: 'bd_x' } }]);
    expect(fakeTurn([system, user('这张是正面【测试：设成正面】')]).calls[0].input).toEqual({ assetId: 'asset_b', kind: 'front' });
    // 这件作品自己沉淀的背景图，列表里写的是第几轮第几张
    const own = { role: 'system' as const, content: '模板库里可选的背景图（use_backdrop 用编号）：bd_own 苔绿晨光（这件作品第 1 轮背景 1，沉淀过的；选它要先问用户：ask_confirm 的 pick_backdrop；色调「苔绿」）' };
    expect(fakeTurn([own, user('删掉它【测试：删背景】')]).calls[0].input).toEqual({ target: 'backdrop', id: 'bd_own' });
  });
});
