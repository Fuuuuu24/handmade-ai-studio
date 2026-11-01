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

  it('剧本里每个工具调用都符合工具的参数格式', async () => {
    for (const [mark, { tool, input }] of Object.entries(FAKE_SCRIPT)) {
      const def = agentTools[tool as keyof typeof agentTools];
      expect(def, mark).toBeTruthy();
      const schema = def.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
      expect(schema.safeParse(input).success, mark).toBe(true);
    }
  });
});
