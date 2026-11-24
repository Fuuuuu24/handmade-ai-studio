import { tool, type FinishReason, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import { INFO_KEYS } from '@/config/info';
import { IMAGE_MODELS } from '@/config/models';
import { RATIOS } from '@/config/ratios';
import { STEP_IDS, type StepId } from '@/config/steps';
import { STYLE_KEYS } from '@/config/style';
import { VIEW_ANGLES } from '@/config/views';
import { ISSUES } from '@/config/verdict';

/* 小间的工具（27 个，技术写法 13.7、14.8）：只有参数格式，没有执行代码。服务端把它们交给模型，模型决定调用哪个；
   执行在浏览器里（agent/executors.ts），硬规则也在那里检查。四类做法（技术写法 14.2）：
   草稿、设置和画布切换，小间直接做；要用户确认的事先问（ask_confirm），用户回复同意后代点（confirm_for_user）；
   删除、停用、替换弹确认框，由用户点「确认」（request_delete、set_photo_kind）；生成只放卡片，由用户点
   （propose_views、request_approval、propose_retry），下载也由用户点（offer_export）。 */

const imageModelIds = IMAGE_MODELS.map((m) => m.id) as [string, ...string[]];
const issueNames = [...ISSUES.real, ...ISSUES.style] as [string, ...string[]];
const kinds = z.enum(['backdrop', 'scene']).describe('backdrop：背景（两张背景图）；scene：合成（两张候选主图）');
// 能推进的几步：出图是最后一步，没有下一步
const handoffSteps = ['product', 'info', 'backdrop', 'placement'] as const satisfies readonly StepId[];

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

// 「要我替你点吗」里的一样（技术写法 14.4）。参数摊平写，按 type 填对应的几项：不同模型对嵌套的多选一格式支持不一
export const ASK_TYPES = ['confirm_view', 'accept_info', 'mark_unknown', 'confirm_summary', 'pick_backdrop', 'save_backdrop', 'verdict', 'switch_flow'] as const;
const askItem = z.object({
  type: z
    .enum(ASK_TYPES)
    .describe(
      'confirm_view 某个角度的三视图「可以用」；accept_info 接受某项信息建议；mark_unknown 把品类、材料或尺寸标「未知」；confirm_summary 确认共创总结；pick_backdrop 选定最新一轮的某张背景；save_backdrop 把选定的背景图沉淀进模板库（起名）；verdict 填某张候选的两项验收；switch_flow 套用模板的作品改成自己生成背景（会切到首页开始的流程）',
    ),
  angle: z.enum(VIEW_ANGLES).optional().describe('confirm_view：front 正面、side 侧面、back 背面'),
  field: z.enum(INFO_KEYS).optional().describe('accept_info、mark_unknown：哪一项信息'),
  round: z.number().int().min(1).optional().describe('pick_backdrop、verdict：第几轮'),
  candidate: z.number().int().min(1).max(2).optional().describe('pick_backdrop、verdict：第几张，从 1 开始'),
  name: z.string().max(20).optional().describe('save_backdrop：沉淀进模板库时的名字'),
  real: z.enum(['ok', 'bad']).optional().describe('verdict：像不像实物，ok 像、bad 不像'),
  style: z.enum(['ok', 'bad']).optional().describe('verdict：风格对不对，ok 对、bad 不对'),
});
export type AskItemInput = z.infer<typeof askItem>;

export const agentTools = {
  update_info: tool({
    outputSchema: toolOutput,
    description:
      '把用户说过的、或从照片里看得出的商品信息写成「待确认建议」（items）；用户在画布上接受，或你用 ask_confirm 问过、用户同意后代点，才成为商品信息。看不出、用户没说的不要猜。withdraw 撤回你之前写的、用户还没处理的建议（比如你说错了）。',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            field: z.enum(INFO_KEYS),
            value: z.string().min(1).max(200),
            note: z.string().max(60).optional().describe('依据，比如「你说的」「照片里看到」'),
          }),
        )
        .max(6)
        .optional(),
      withdraw: z.array(z.enum(INFO_KEYS)).max(6).optional().describe('要撤回建议的那几项'),
    }),
  }),
  rename_work: tool({
    outputSchema: toolOutput,
    description:
      '给作品改名，直接生效（顶栏同步）。作品还叫「未命名作品」、品类已经清楚时起一个；已经有名字的，用户让你改才改。简短、按品类和造型起，比如「银杏叶耳坠」，不编造寓意。',
    inputSchema: z.object({ name: z.string().min(1).max(20) }),
  }),
  set_photo_kind: tool({
    outputSchema: toolOutput,
    description:
      '给一张照片选类型（照片编号见作品状态）：front 正面、side 侧面、back 背面、detail 细节、unsorted 未分类。每个角度只放一张：会把某个角度现在的照片顶掉（退回未分类），或把正在用作某个角度的照片移走时，页面先弹确认框，用户点「确认」才改，取消就不改、不要追问。用户在对话里发了新照片、说要换掉某个角度的那张时，用它把新照片设成那个角度。',
    inputSchema: z.object({
      assetId: z.string().min(1),
      kind: z.enum(['front', 'side', 'back', 'detail', 'unsorted']),
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
    description:
      '记录用户讲的作品灵感、主题或情绪的要点（背景共创用），用用户自己的意思，不添加用户没说的经历或寓意。用户明确说暂时没有故事、想把重点放在造型和材质上时，noStory 填 true（画布上的「暂无明确故事」会勾上）；后来又讲出了故事，填 false。',
    inputSchema: z.object({
      kind: z.enum(['inspiration', 'theme', 'emotion', 'other']),
      text: z.string().min(1).max(300),
      noStory: z.boolean().optional(),
    }),
  }),
  draft_summary: tool({
    outputSchema: toolOutput,
    description:
      '起草背景共创的三项总结：作品想表达什么、希望顾客感受到什么、明确避免什么。只能是草稿：用户在画布上点「确认总结」，或你用 ask_confirm 问过、用户同意后代点，才算确认。必须基于用户说过的内容；用户说没有故事时如实写。',
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
  set_backdrop_mode: tool({
    outputSchema: toolOutput,
    description:
      '选背景的做法：library 用模板库里的（选一张，不做共创），generate 自己生成（先共创，再生成两张选一张）。换做法会清掉已选的背景图（之后可以再选回来）。套用模板的作品改成自己生成会切到首页开始的流程、改不回去，不能用这个工具：先用 ask_confirm（switch_flow）问用户。',
    inputSchema: z.object({ mode: z.enum(['library', 'generate']) }),
  }),
  use_backdrop: tool({
    outputSchema: toolOutput,
    description:
      '选用模板库里的一张背景图（作品状态里列出了可选的背景图及编号）：内置模板或已沉淀进模板库的。这件作品自己生成的背景图（沉淀进模板库的也算）不用它选：先用 ask_confirm（pick_backdrop，第几轮第几张见作品状态）问用户，用户同意后代点。',
    inputSchema: z.object({ backdropId: z.string().min(1) }),
  }),
  redesign_backdrop: tool({
    outputSchema: toolOutput,
    description:
      '「重新设计背景」：放开选定的、这件作品自己生成的背景图，背景五项又能改；改好后重写背景提示词，请用户批准再生成一轮。原来那张还在，可以再选回来。用的是模板库里的背景时不用它，换一张模板（use_backdrop）就行。',
    inputSchema: z.object({}),
  }),
  rename_backdrop: tool({
    outputSchema: toolOutput,
    description: '给模板库里自己沉淀的背景图改名（编号见作品状态里的模板库）。内置模板不能改名。',
    inputSchema: z.object({ backdropId: z.string().min(1), name: z.string().min(1).max(20) }),
  }),
  draft_backdrop_prompt: tool({
    outputSchema: toolOutput,
    description:
      '写背景图的提示词（中文），只在背景「自己生成」时用。写之前确认共创总结已确认、背景五项已定；品类、材料、尺寸、不能改的细节里还有待用户处理的建议时会被拒绝。',
    inputSchema: z.object({ prompt: z.string().min(20).max(2000) }),
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
    description:
      '在对话里放出批准卡片，请用户确认方案：kind=backdrop 是背景方案（自己生成背景时），kind=scene 是合成方案。批准和发起生成是同一下（用户滑动「批准并生成」），你不能代替用户批准，也没有发起生成的工具；卡片会列出还缺什么。',
    inputSchema: z.object({ kind: kinds, note: z.string().max(200).optional() }),
  }),
  propose_retry: tool({
    outputSchema: toolOutput,
    description:
      '某一张没生成出来时，在对话里放「补齐这一张」卡片，用户点了才补（要花一张图的钱）：kind=backdrop 补背景图，kind=scene 补候选主图。只能补失败的，次数有上限；批准后方案改过就不能补。',
    inputSchema: z.object({ kind: kinds, ...candidateRef }),
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
  note_feedback: tool({
    outputSchema: toolOutput,
    description:
      '记下用户对某张候选主图的意见：问题标签和用户原话。两项验收（像不像、风格对不对）要用户判断：他在画布上点，或你用 ask_confirm（verdict）问过、他同意后代点。revise=true 时同时「从这一张修改」：合成方案恢复成那一版，原结果保留，改好后请用户重新批准。',
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
  ask_confirm: tool({
    outputSchema: toolOutput,
    description:
      '要替用户点「确认」「选定」「验收」这类按钮之前，先用它在对话里放一张「要我替你点吗」卡片，列出要点的几样（每样能不能点，和画布上的按钮同一个条件，点不了的会被拒绝）。用户回复同意后再用 confirm_for_user 代点。用户自己先说了「帮我确认」也要先问一次。同一时间只有一张卡片在等回复，再问会作废上一张。',
    inputSchema: z.object({ items: z.array(askItem).min(1).max(8) }),
  }),
  confirm_for_user: tool({
    outputSchema: toolOutput,
    description:
      '用户回复同意后，替他点 ask_confirm 卡片上的那几样（效果和画布上的按钮一样）。quote 逐字照抄用户表示同意的那一小句的全文（以标点或空格分开的一小句，比如「好的，同意」里的「同意」，「没问题，都点吧」里的「没问题」）；代码会到你问过之后用户发的消息里核对，不是整句的不算，就不代点。用户只同意一部分时，only 填卡片上的序号；用户没同意、说再看看、或者还没回复时不要调用。问过之后那几样变了（用户自己点了、改了，或者又生成了新的），这次请求作废，要重新问。',
    inputSchema: z.object({
      quote: z.string().min(1).max(60),
      only: z.array(z.number().int().min(1).max(8)).max(8).optional(),
    }),
  }),
  next_step: tool({
    outputSchema: toolOutput,
    description:
      '一步做完、用户没在接着改这一步时，推进到下一步：画布切过去（和用户点「下一步」一样，只是不再发交接消息）。step 填做完的那一步：product 商品、info 信息、backdrop 背景、placement 摆放；出图是最后一步，没有下一步。没做完会被拒绝并写明缺什么。结果里带着这一页的内容，用一两句话告诉用户这一步定了什么、接下来做什么。',
    inputSchema: z.object({ step: z.enum(handoffSteps) }),
  }),
  show_step: tool({
    outputSchema: toolOutput,
    description: '让右侧画布切到某一步：product 商品、info 信息、backdrop 背景、placement 摆放、result 出图。',
    inputSchema: z.object({ step: z.enum(STEP_IDS) }),
  }),
  request_delete: tool({
    outputSchema: toolOutput,
    description:
      '删除类操作：页面弹出和画布上一样的确认框，用户点「确认」才执行。target=photo 停用一张照片（id 填照片编号，原图记录保留）；target=backdrop 从模板库删除一张自己沉淀的背景图（id 填编号，已经选了它的作品照常可用）；target=work 删除这件作品（照片、对话、方案和结果一起删，不能恢复，不填 id）。只在用户明确要删时用；用户点「取消」就不执行，不要追问，除非他又说要删。',
    inputSchema: z.object({ target: z.enum(['photo', 'backdrop', 'work']), id: z.string().optional() }),
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
