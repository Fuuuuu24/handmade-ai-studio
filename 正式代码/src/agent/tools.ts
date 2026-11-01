import { tool, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import { INFO_KEYS } from '@/config/info';
import { IMAGE_MODELS } from '@/config/models';
import { RATIOS } from '@/config/ratios';
import { STEPS } from '@/config/steps';
import { STYLE_KEYS } from '@/config/style';
import { ISSUES } from '@/config/verdict';

/* 小间的工具：只有参数格式，没有执行代码。服务端把它们交给模型，模型决定调用哪个；
   执行在浏览器里（agent/executors.ts），硬规则也在那里检查。批准、确认总结、同意改长期风格这类操作只在界面按钮里，没有对应工具。 */

const stepIds = STEPS.map((s) => s.id) as [string, ...string[]];
const imageModelIds = IMAGE_MODELS.map((m) => m.id) as [string, ...string[]];
const issueNames = [...ISSUES.real, ...ISSUES.style] as [string, ...string[]];

// 第几轮第几张：和作品状态里的「第 N 轮」「候选 M」一致，张数从 1 开始
const candidateRef = {
  round: z.number().int().min(1),
  candidate: z.number().int().min(1).max(2).describe('候选几，从 1 开始'),
};

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
  offer_picks: tool({
    outputSchema: toolOutput,
    description:
      '用户说「不知道」「你帮我推荐」时，在对话里放出 2～4 张方向卡片让用户挑（AC-04.2）。每个方向一句话标题加一句理由，必须贴合照片里的作品，不编造作者经历。用户点了卡片会把选择发给你。',
    inputSchema: z.object({
      question: z.string().max(60).optional().describe('卡片上方的一句提问，比如「你更想让顾客感受到哪一种？」'),
      options: z
        .array(z.object({ title: z.string().min(1).max(24), reason: z.string().min(1).max(80) }))
        .min(2)
        .max(4),
    }),
  }),
  make_white_asset: tool({
    outputSchema: toolOutput,
    description:
      '资产路线为 A 时，用生图模型按一张整体或背面照做白底图（要花一张图的钱）。不填 assetId 时用第一张整体照。做好后由用户在画布上对照原图选用，你不能替用户选。',
    inputSchema: z.object({ assetId: z.string().optional().describe('照片编号，见作品状态里的「照片编号」') }),
  }),
  set_image_model: tool({
    outputSchema: toolOutput,
    description: '换生图模型（用户明确要求时才换）。已经批准的方案会因此失效，提示词也要按新模型核对。',
    inputSchema: z.object({ model: z.enum(imageModelIds) }),
  }),
  retry_candidate: tool({
    outputSchema: toolOutput,
    description: '补齐失败的一张候选（用户同意后再调用，要花钱）。只能补失败的，次数有上限；批准后方案改过就不能补。',
    inputSchema: z.object(candidateRef),
  }),
  note_feedback: tool({
    outputSchema: toolOutput,
    description:
      '记下用户对某张候选的意见：问题标签和用户原话。验收「像不像」「风格对不对」只能由用户在画布上点，你不能代点。revise=true 时同时「从这一张修改」：方案恢复成那一版，原结果保留，改好后请用户重新批准。',
    inputSchema: z.object({
      ...candidateRef,
      issues: z.array(z.enum(issueNames)).max(10),
      note: z.string().max(200).optional(),
      revise: z.boolean(),
    }),
  }),
  offer_export: tool({
    outputSchema: toolOutput,
    description: '在对话里放出下载卡片，让用户导出一张候选。只有两项验收都满意的候选才能导出（AC-10.1）；下载由用户点。',
    inputSchema: z.object(candidateRef),
  }),
  propose_scene_save: tool({
    outputSchema: toolOutput,
    description:
      '提议把现在的方案（色调、背景、光线、摆放、道具、禁止出现、构图）存成摄影布景，以后别的作品可以套用。放出卡片，用户确认才保存。updateSceneId 填已存布景的编号时，提议更新那一套（生成新版本）。',
    inputSchema: z.object({
      name: z.string().min(1).max(20),
      updateSceneId: z.string().optional(),
      reason: z.string().max(80).optional(),
    }),
  }),
  propose_shop_style: tool({
    outputSchema: toolOutput,
    description:
      '提议把这件作品风格卡里的几项写进「我的风格」（店铺长期偏好）。放出卡片，列出修改前后，用户同意才写入；单件作品的调整不会自动改长期风格。',
    inputSchema: z.object({ fields: z.array(z.enum(STYLE_KEYS)).min(1).max(8), reason: z.string().min(1).max(80) }),
  }),
  note_followup: tool({
    outputSchema: toolOutput,
    description: '记下本期不支持、以后可能做的需求（比如真人佩戴图、详情页），不要记进共创记录。',
    inputSchema: z.object({ text: z.string().min(1).max(120) }),
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
