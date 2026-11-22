import { tool, type FinishReason, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import { INFO_KEYS } from '@/config/info';
import { IMAGE_MODELS } from '@/config/models';
import { RATIOS } from '@/config/ratios';
import { STEP_IDS } from '@/config/steps';
import { STYLE_KEYS } from '@/config/style';
import { VIEW_ANGLES } from '@/config/views';
import { ISSUES } from '@/config/verdict';

/* 小间的工具（21 个，技术写法 13.7）：只有参数格式，没有执行代码。服务端把它们交给模型，模型决定调用哪个；
   执行在浏览器里（agent/executors.ts），硬规则也在那里检查。批准、确认总结、确认三视图、选定背景候选、
   沉淀／改名／删除背景图这类操作只在界面按钮里，没有对应工具。 */

const imageModelIds = IMAGE_MODELS.map((m) => m.id) as [string, ...string[]];
const issueNames = [...ISSUES.real, ...ISSUES.style] as [string, ...string[]];
const kinds = z.enum(['backdrop', 'scene']).describe('backdrop：背景（两张背景图）；scene：合成（两张候选主图）');

// 第几轮第几张：和作品状态里的「第 N 轮」「候选 M」一致，张数从 1 开始
const candidateRef = {
  round: z.number().int().min(1),
  candidate: z.number().int().min(1).max(2).describe('第几张，从 1 开始'),
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
  suggest_name: tool({
    outputSchema: toolOutput,
    description:
      '给作品起一个名字建议（作品还叫「未命名作品」、品类已经清楚时用）。简短、按品类和造型起，比如「银杏叶耳坠」，不编造寓意。只是建议，用户在顶栏接受后才改名。',
    inputSchema: z.object({
      name: z.string().min(1).max(20),
      note: z.string().max(40).optional().describe('依据，比如「按品类和造型起的」'),
    }),
  }),
  propose_views: tool({
    outputSchema: toolOutput,
    description:
      '在对话里放出「生成三视图」卡片：按正面、侧面、背面三张照片各生成一张白底图，用户点了卡片才生成（每张要花一张图的钱）。不填 angles 时生成还没有三视图的角度；用户说某一张不像时，angles 填那个角度，提议重做。缺正面、侧面、背面任何一张照片时会被拒绝。',
    inputSchema: z.object({
      angles: z.array(z.enum(VIEW_ANGLES)).max(3).optional(),
      note: z.string().max(80).optional().describe('卡片上的一句说明，比如「侧面那张扣头画歪了，重做一张」'),
    }),
  }),
  record_story: tool({
    outputSchema: toolOutput,
    description: '记录用户讲的作品灵感、主题或情绪的要点（背景共创用），用用户自己的意思，不添加用户没说的经历或寓意。',
    inputSchema: z.object({
      kind: z.enum(['inspiration', 'theme', 'emotion', 'other']),
      text: z.string().min(1).max(300),
    }),
  }),
  draft_summary: tool({
    outputSchema: toolOutput,
    description:
      '起草背景共创的三项总结：作品想表达什么、希望顾客感受到什么、明确避免什么。只能是草稿，用户在卡片上确认。必须基于用户说过的内容；用户说没有故事时如实写。',
    inputSchema: z.object({
      express: z.string().min(1).max(200),
      feel: z.string().max(200),
      avoid: z.string().max(200),
    }),
  }),
  set_style: tool({
    outputSchema: toolOutput,
    description:
      '修改风格卡的一项或多项。背景五项：tone 色调、background 背景、light 光线、props 装饰道具（苔藓、旧书、丝带等）、bannedBackdrop 背景禁止项；摆放三项：placement 摆放（平铺、悬挂，支架、挂钩、首饰托盘这类展示用具也写在这里）、composition 构图、bannedScene 合成禁止项。背景图选定后背景五项以背景图为准，不能改。basis=said 只用于用户原话里明确说过的那一项，并且必须在 quote 里逐字照抄用户的原话片段；代码会到用户的消息和用户手改的提示词里核对，找不到就记为「小间推荐」。从感受、氛围推断出来的都是你的推荐，写 basis=recommend，会显示为「小间推荐」。道具不放时 value 写「不放道具」。',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            field: z.enum(STYLE_KEYS),
            value: z.string().max(120),
            basis: z.enum(['said', 'recommend']),
            quote: z.string().max(60).optional().describe('basis=said 时必填：用户原话里的那几个字，逐字照抄，比如「平铺」「米白灰泥墙」'),
            reason: z.string().max(120).optional(),
          }),
        )
        .min(1)
        .max(8),
    }),
  }),
  use_backdrop: tool({
    outputSchema: toolOutput,
    description:
      '选用模板库里的一张背景图（作品状态里列出了可选的背景图及编号）：内置模板或已沉淀进模板库的。这件作品自己生成、还没沉淀的背景候选不能用这个工具选，要由用户在画布上点「用这张」。',
    inputSchema: z.object({ backdropId: z.string().min(1) }),
  }),
  draft_backdrop_prompt: tool({
    outputSchema: toolOutput,
    description:
      '写背景图的提示词（中文），只在背景「自己生成」时用。写之前确认共创总结已确认、背景五项已定；品类、材料、尺寸、不能改的细节里还有待用户处理的建议时会被拒绝。',
    inputSchema: z.object({ prompt: z.string().min(20).max(2000) }),
  }),
  start_backdrop_generation: tool({
    outputSchema: toolOutput,
    description: '按用户已经批准的背景方案生成两张背景图。没有有效的背景批准时会被拒绝并返回原因。',
    inputSchema: z.object({}),
  }),
  set_ratio: tool({
    outputSchema: toolOutput,
    description: '设置合成主图的比例（只有合成比例可选，三视图和背景图的比例由系统固定）。已经批准的合成方案会因此失效。',
    inputSchema: z.object({ ratio: z.enum(RATIOS) }),
  }),
  draft_prompt: tool({
    outputSchema: toolOutput,
    description:
      '写合成提示词（中文）：拿选定的背景图和三张三视图生成两张主图。没有选定的背景图、三视图没全部确认时会被拒绝；品类、材料、尺寸、不能改的细节里还有待用户处理的建议时也会被拒绝。',
    inputSchema: z.object({ prompt: z.string().min(20).max(2000) }),
  }),
  resolve_prompt_sync: tool({
    outputSchema: toolOutput,
    description:
      '用户手改提示词后：先把能对应到风格卡的改动用 set_style（basis=said，quote 抄用户在提示词里新写的字）写回，再调用本工具报告核对结果。which 是改的哪一段（backdrop 背景提示词、scene 合成提示词）。没有矛盾传空列表；对不上的逐条写出来，请用户决定。',
    inputSchema: z.object({ which: kinds, conflicts: z.array(z.string().min(1).max(120)).max(6) }),
  }),
  request_approval: tool({
    outputSchema: toolOutput,
    description: '在对话里放出批准卡片，请用户确认方案：kind=backdrop 是背景方案（自己生成背景时），kind=scene 是合成方案。你不能代替用户批准；卡片会列出还缺什么。',
    inputSchema: z.object({ kind: kinds, note: z.string().max(200).optional() }),
  }),
  start_generation: tool({
    outputSchema: toolOutput,
    description: '按用户已经批准的合成方案生成两张候选主图。没有有效批准时会被拒绝并返回原因。',
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
  set_image_model: tool({
    outputSchema: toolOutput,
    description: '换生图模型（用户明确要求时才换；三视图、背景、合成都用它）。已确认的三视图和已选定的背景图不作废，已经批准的方案会失效，提示词也要按新模型核对。',
    inputSchema: z.object({ model: z.enum(imageModelIds) }),
  }),
  retry_candidate: tool({
    outputSchema: toolOutput,
    description: '补齐失败的一张（用户同意后再调用，要花钱）：kind=backdrop 补背景图，kind=scene 补候选主图。只能补失败的，次数有上限；批准后方案改过就不能补。',
    inputSchema: z.object({ kind: kinds, ...candidateRef }),
  }),
  note_feedback: tool({
    outputSchema: toolOutput,
    description:
      '记下用户对某张候选主图的意见：问题标签和用户原话。验收「像不像」「风格对不对」只能由用户在画布上点，你不能代点。revise=true 时同时「从这一张修改」：合成方案恢复成那一版，原结果保留，改好后请用户重新批准。',
    inputSchema: z.object({
      ...candidateRef,
      issues: z.array(z.enum(issueNames)).max(10),
      note: z.string().max(200).optional(),
      revise: z.boolean(),
    }),
  }),
  offer_export: tool({
    outputSchema: toolOutput,
    description: '在对话里放出下载卡片，让用户导出一张候选。只有两项验收都满意的候选才能导出（AC-10.1）；下载由用户点。卡片上会提醒：这是 AI 生成的图，发布时请按平台要求声明。',
    inputSchema: z.object(candidateRef),
  }),
  note_followup: tool({
    outputSchema: toolOutput,
    description: '记下本期不支持、以后可能做的需求（比如真人佩戴图、详情页），不要记进共创记录。',
    inputSchema: z.object({ text: z.string().min(1).max(120) }),
  }),
  show_step: tool({
    outputSchema: toolOutput,
    description: '让右侧画布切到某一步：product 商品、info 信息、backdrop 背景、placement 摆放、result 出图。',
    inputSchema: z.object({ step: z.enum(STEP_IDS) }),
  }),
};

export type AgentTools = typeof agentTools;
export type ToolName = keyof AgentTools;

export type ToolOutput = z.infer<typeof toolOutput>;

export interface MessageMeta {
  model?: string;
  modelLabel?: string;
  costUSD?: number;
  // 最近一次请求怎么结束的：模型给的结束原因，或者服务端超时中止（timeout）。每次请求开始时清空（null）。
  // 只有思考、没写完时界面据此说明原因（BC-001），也留给排查
  endReason?: FinishReason | 'timeout' | 'aborted' | null;
  // 浏览器代发的系统消息（技术写法 13.12）：「下一步」交接、生成和验收通知。界面显示为小卡片，不当成用户原话
  system?: 'handoff' | 'notice';
}

// 用户消息里附带的照片只记素材编号，图片本身每次请求单独附上（技术写法第 6 节）
export type AgentDataParts = { photos: { assetIds: string[] } };

export type AgentUIMessage = UIMessage<MessageMeta, AgentDataParts, InferUITools<AgentTools>>;
