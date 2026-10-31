import { tool, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import { INFO_KEYS } from '@/config/info';
import { RATIOS } from '@/config/ratios';
import { STEPS } from '@/config/steps';
import { STYLE_KEYS } from '@/config/style';

/* 小间的工具：只有参数格式，没有执行代码。服务端把它们交给模型，模型决定调用哪个；
   执行在浏览器里（agent/executors.ts），硬规则也在那里检查。批准、确认总结、同意改长期风格这类操作只在界面按钮里，没有对应工具。 */

const stepIds = STEPS.map((s) => s.id) as [string, ...string[]];

// 工具执行结果的统一格式：ok 表示照做了；message 给模型看，也作为对话里的操作记录（AC-11.4）
const toolOutput = z.object({
  ok: z.boolean(),
  message: z.string(),
  changes: z.array(z.string()).optional(),
});

export const agentTools = {
  update_info: tool({
    outputSchema: toolOutput,
    description:
      '把用户说过的、或从照片里看得出的商品信息写成「待确认建议」，用户在画布上接受后才生效。看不出、用户没说的不要猜。',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            field: z.enum(INFO_KEYS),
            value: z.string().min(1).max(200),
            note: z.string().max(60).optional().describe('依据，比如「你说的」「照片里看到」'),
          }),
        )
        .min(1)
        .max(6),
    }),
  }),
  record_story: tool({
    outputSchema: toolOutput,
    description: '记录用户讲的作品灵感、主题或情绪的要点，用用户自己的意思，不添加用户没说的经历或寓意。',
    inputSchema: z.object({
      kind: z.enum(['inspiration', 'theme', 'emotion', 'other']),
      text: z.string().min(1).max(300),
    }),
  }),
  draft_summary: tool({
    outputSchema: toolOutput,
    description:
      '起草共创三项总结：作品想表达什么、希望顾客感受到什么、明确避免什么。只能是草稿，用户在卡片上确认。必须基于用户说过的内容；用户说没有故事时如实写。',
    inputSchema: z.object({
      express: z.string().min(1).max(200),
      feel: z.string().max(200),
      avoid: z.string().max(200),
    }),
  }),
  set_style: tool({
    outputSchema: toolOutput,
    description:
      '修改风格卡的一项或多项。basis=said 表示用户明确说过；basis=recommend 表示你的推荐，会显示为待确认。道具不放时 value 写「不放道具」。',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            field: z.enum(STYLE_KEYS),
            value: z.string().max(120),
            basis: z.enum(['said', 'recommend']),
            reason: z.string().max(120).optional(),
          }),
        )
        .min(1)
        .max(8),
    }),
  }),
  apply_scene: tool({
    outputSchema: toolOutput,
    description: '套用一套摄影布景（状态里列出了可用布景及编号），覆盖色调、背景、光线、摆放、道具、构图。',
    inputSchema: z.object({ sceneId: z.string().min(1) }),
  }),
  set_ratio: tool({
    outputSchema: toolOutput,
    description: '设置主图比例。已经批准的方案会因此失效。',
    inputSchema: z.object({ ratio: z.enum(RATIOS) }),
  }),
  draft_prompt: tool({
    outputSchema: toolOutput,
    description: '写最终的生图提示词（中文）。写之前确认商品信息、共创总结和风格都已就绪。',
    inputSchema: z.object({ prompt: z.string().min(20).max(2000) }),
  }),
  resolve_prompt_sync: tool({
    outputSchema: toolOutput,
    description:
      '用户手改提示词后：先把能对应到风格卡的改动用 set_style（basis=said）写回，再调用本工具报告核对结果。没有矛盾传空列表；对不上的逐条写出来，请用户决定。',
    inputSchema: z.object({ conflicts: z.array(z.string().min(1).max(120)).max(6) }),
  }),
  request_approval: tool({
    outputSchema: toolOutput,
    description: '在对话里放出批准卡片，请用户确认方案。你不能代替用户批准；卡片会列出还缺什么。',
    inputSchema: z.object({ note: z.string().max(200).optional() }),
  }),
  start_generation: tool({
    outputSchema: toolOutput,
    description: '按用户已经批准的方案生成两张候选图。没有有效批准时会被拒绝并返回原因。',
    inputSchema: z.object({}),
  }),
  show_step: tool({
    outputSchema: toolOutput,
    description: '让右侧画布切到某一步，方便用户查看和修改。',
    inputSchema: z.object({ step: z.enum(stepIds) }),
  }),
};

export type AgentTools = typeof agentTools;
export type ToolName = keyof AgentTools;

export type ToolOutput = z.infer<typeof toolOutput>;

export interface MessageMeta {
  model?: string;
  modelLabel?: string;
  costUSD?: number;
}

// 用户消息里附带的照片只记素材编号，图片本身每次请求单独附上（技术写法第 6 节）
export type AgentDataParts = { photos: { assetIds: string[] } };

export type AgentUIMessage = UIMessage<MessageMeta, AgentDataParts, InferUITools<AgentTools>>;
