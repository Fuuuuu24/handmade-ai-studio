import type { CoreInfoKey, InfoKey } from '@/config/info';
import type { Ratio } from '@/config/ratios';
import type { Flow, StepId } from '@/config/steps';
import type { BackdropKey, SceneKey, StyleKey } from '@/config/style';
import type { ASSET_KINDS } from '@/config/upload';
import type { ViewAngle } from '@/config/views';

export type Id = string;
export type { Flow, ViewAngle };

/* ---------- 商品信息 ---------- */

// 小间写入的只能是建议，用户接受（或问过用户、用户同意后小间代点）才进入 value（PRD 4.2 第 2、3 条）
export interface Suggestion {
  value: string;
  note?: string;
  at: number;
}

export interface InfoField {
  value: string; // 已确认的值；空串表示没有
  unknown: boolean; // 用户明确标「未知」
  suggestion?: Suggestion;
}

export type Info = Record<InfoKey, InfoField>;

/* ---------- 共创（v0.6 是背景图的共创，只在「自己生成」背景时做） ---------- */

export interface StorySummary {
  express: string; // 作品想表达什么
  feel: string; // 希望顾客感受到什么
  avoid: string; // 明确避免什么
}

export interface StoryNote {
  id: Id;
  kind: 'inspiration' | 'theme' | 'emotion' | 'other';
  text: string;
  at: number;
}

export interface Story {
  notes: StoryNote[];
  noStory: boolean; // 「暂无明确故事」（AC-04.5）
  summary: StorySummary | null;
  summaryState: 'none' | 'draft' | 'confirmed'; // 小间只能写草稿；确认由用户点，或问过用户、用户同意后小间代点
  drafted?: StorySummary; // 小间最后一次起草的原文，和 summary 对比就知道用户改了哪几项（BC-003）
}

/* ---------- 风格 ---------- */

// user：用户在画布里改的；said：小间按用户明确说过的写入；recommend：小间推荐，批准方案即确认
export type StyleSource = 'user' | 'said' | 'recommend';

export interface StyleValue {
  value: string;
  source: StyleSource;
  reason?: string;
  quote?: string; // source 为 said 时：用户原话片段，代码核对过确实是用户写的（BC-013）
}

export type Style = Record<StyleKey, StyleValue>;

export type BackdropParams = Record<BackdropKey, string>;
export type SceneParams = Record<SceneKey, string>;

/* ---------- 背景图与模板库（PRD FR-06） ---------- */

// 这件作品生成的背景图（候选）。生成后不再修改（AC-06.5）；用户选择「沉淀进模板库」后别的作品也能套用。
// 删除只做标记：已经选了它的作品照常可以合成，历史结果仍能看到（AC-06.4）
export interface Backdrop {
  id: Id;
  name: string;
  blobId: Id;
  thumbId: Id;
  width: number;
  height: number;
  ratio: Ratio;
  params: BackdropParams; // 生成时的背景五项
  prompt: string;
  imageModel: string;
  workId: Id; // 出自哪件作品
  taskId: Id;
  round: number; // 这件作品第几轮背景
  slot: number;
  savedAt: number | null; // 沉淀进模板库的时间；没沉淀为空
  createdAt: number;
  deletedAt: number | null;
}

// 选定的背景图，内置模板和数据库里的背景图统一成这一种（内置模板参数为空）
export interface BackdropRef {
  id: Id;
  name: string;
  builtin: boolean;
  placeholder: boolean; // 内置模板的图还没提供，用色块示意
  params: BackdropParams | null;
  workId: Id | null; // 出自哪件作品；内置为空
  saved: boolean;
  deleted: boolean;
  blobId: Id | null; // 数据库里的图；内置模板为空
  thumbId: Id | null;
  image: string | null; // 内置模板的图片地址
  colors: readonly string[] | null; // 内置模板的示意色块
}

/* ---------- 方案、提示词与批准 ---------- */

export type CoreInfoBasis = Record<CoreInfoKey, { value: string; unknown: boolean }>;

// 背景提示词的依据（PRD AC-07.3）：背景五项、共创总结、品类和尺寸、生图模型；比例固定，不进依据
export interface BackdropBasis {
  style: BackdropParams;
  summary: StorySummary | null;
  info: Pick<CoreInfoBasis, 'category' | 'size'>;
  imageModel: string;
}

export interface BackdropSnapshot extends BackdropBasis {
  prompt: string;
  count: number;
}

// 合成提示词的依据：三视图、核心信息、共创总结（没做共创时为空）、背景图、摆放三项、比例、生图模型
export interface SceneBasis {
  references: Id[]; // 三视图，按正面、侧面、背面
  info: CoreInfoBasis;
  summary: StorySummary | null;
  backdropId: Id | null;
  style: SceneParams;
  ratio: Ratio;
  imageModel: string;
}

export interface SceneSnapshot extends SceneBasis {
  prompt: string;
  count: number;
}

export type PromptKind = 'backdrop' | 'scene';

export interface PromptBases {
  backdrop: BackdropBasis;
  scene: SceneBasis;
}

// sync：手改提示词后小间核对的结果；unchecked／conflict 时不能批准（技术写法第 5 节第 4 条）
export interface PromptState<B> {
  text: string;
  basis: B;
  author: 'agent' | 'user';
  edited: boolean;
  sync: 'ok' | 'unchecked' | 'conflict';
  conflicts: string[];
  original: { text: string; basis: B } | null; // 小间写的最后一版，撤销手改时恢复
  at: number;
}

interface ApprovalBase {
  id: Id;
  workId: Id;
  version: number; // 第几版方案（背景、合成各自编号）
  at: number;
  usedRound: number | null; // 每次批准只能发起一轮生成
}

export interface BackdropApproval extends ApprovalBase {
  kind: 'backdrop';
  snapshot: BackdropSnapshot;
}

export interface SceneApproval extends ApprovalBase {
  kind: 'scene';
  snapshot: SceneSnapshot;
  parentResultId?: Id | null; // 这版方案是从哪张结果改出来的（AC-09.4）
}

export type Approval = BackdropApproval | SceneApproval;

// 从某张结果修改（AC-09.4）：记下父结果，以及修改前的方案，取消时恢复
export interface Revision {
  fromResultId: Id;
  reasons: string[]; // 当时验收指出的问题
  prev: {
    scene: Pick<Style, SceneKey>;
    backdropId: Id | null;
    backdropMode: BackdropMode | null;
    ratio: Ratio;
    imageModel: string;
    prompt: PromptState<SceneBasis> | null;
  };
}

/* ---------- 作品 ---------- */

// 背景这一步选哪种做法：library 用模板库里的，generate 自己生成（共创 → 批准 → 两张选一张）
export type BackdropMode = 'library' | 'generate';

// 作品的一条事实：显示的文字，加上用来判断「换了一张」「改过了」的编号（照片、三视图、背景图、提示词原文）
export interface Fact {
  text: string;
  id?: string;
}

// 上次「下一步」交接时的作品快照（技术写法 13.12）：摘要里列出之后改了什么
export interface Handoff {
  step: StepId;
  at: number;
  facts: Record<string, Fact>;
}

/* ---------- 小间问过再代点（技术写法 14.4） ---------- */

export type VerdictPick = 'ok' | 'bad';

// 小间能替用户点的几样，和画布上的按钮一一对应：确认三视图、接受信息建议、标「未知」、确认共创总结、
// 选定背景候选、沉淀进模板库、两项验收、流程二改自己生成背景（会切到流程一）。张数和候选从 1 开始
export type AskAction =
  | { type: 'confirm_view'; angle: ViewAngle }
  | { type: 'accept_info'; field: InfoKey }
  | { type: 'mark_unknown'; field: InfoKey }
  | { type: 'confirm_summary' }
  | { type: 'pick_backdrop'; round: number; candidate: number }
  | { type: 'save_backdrop'; name: string }
  | { type: 'verdict'; round: number; candidate: number; real?: VerdictPick; style?: VerdictPick }
  | { type: 'switch_flow' };

export interface AskItem {
  action: AskAction;
  text: string; // 卡片上的一行，比如「正面三视图可以用」
  target: Id | null; // 要点的那样东西：三视图、背景图、结果的编号；卡片据此放「对照」「看大图」
  mark: string; // 问的时候那样东西的样子，代点前再比一次，变了整条请求作废
}

// waiting 等用户回复；done 代点过（可能只点了一部分）；expired 东西变了作废；replaced 又问了新的
export type AskState = 'waiting' | 'done' | 'expired' | 'replaced';

export interface Ask {
  id: Id; // 小间这次 ask_confirm 调用的编号，对话里的卡片按它找
  at: number;
  items: AskItem[];
  state: AskState;
  quote?: string; // 代点时引用的用户原话
  done?: number[]; // 代点了哪几样（items 的下标）
  reason?: string; // 作废的原因
  closedAt?: number;
}

export interface Work {
  id: Id;
  name: string;
  createdAt: number;
  updatedAt: number;
  flow: Flow;
  info: Info;
  story: Story;
  style: Style;
  styleSummary?: StorySummary | null; // 小间推荐风格时依据的共创总结；总结之后改了，推荐可能要跟着变（AC-04.6）
  backdropMode: BackdropMode | null; // 还没选做法时为空
  backdropId: Id | null; // 选定的背景图：内置模板是带版本的编号，其余是 backdrops 表的编号
  backdropPrompt: PromptState<BackdropBasis> | null;
  backdropApprovalId: Id | null; // 最近一次背景批准
  backdropApprovalCount: number;
  backdropRound: number; // 已发起的背景生成轮数
  ratio: Ratio; // 合成比例，全流程唯一可选的比例
  imageModel: string; // 三视图、背景、合成都用它（AC-08.7）
  chatModel: string;
  prompt: PromptState<SceneBasis> | null; // 合成提示词
  approvalId: Id | null; // 最近一次合成批准
  approvalCount: number;
  round: number; // 已发起的合成轮数
  costUSD: number; // 这件作品累计花费（对话＋生图），试用记录用
  revision?: Revision; // 正在从某张结果修改；开始生成后清掉
  followups?: Followup[]; // 本期不支持、先记下的需求（如真人佩戴，AC-02.5）
  proposals?: Record<Id, 'accepted' | 'declined'>; // 小间提议卡片上用户的决定，按工具调用编号记
  lastHandoff?: Handoff | null;
  pendingHandoffs?: StepId[]; // 用户点了「下一步」、还没发给小间的交接（对话空闲时发出，内容在发出那一刻生成）
  asks?: Record<Id, Ask>; // 小间问过「要我替你点吗」的请求，按编号记；同一时间只有一条在等回复（技术写法 14.4）
}

export interface Followup {
  id: Id;
  text: string;
  at: number;
}

/* ---------- 素材 ---------- */

export type AssetKind = keyof typeof ASSET_KINDS;

// 原图（upload）和三视图（view）。三视图从同角度的原图派生，记来源，不覆盖原图（AC-02.2）
export interface Asset {
  id: Id;
  workId: Id;
  origin: 'upload' | 'view';
  kind: AssetKind;
  view?: ViewAngle; // 三视图的角度
  parentId?: Id; // 三视图的来源原图
  confirmed?: boolean; // 三视图对照后确认可以用（用户点，或用户同意后小间代点）；可以取消
  taskId?: Id; // 三视图出自哪个任务
  blobId: Id;
  thumbId: Id;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  createdAt: number;
  removed: boolean; // 不再使用；原图记录始终保留（PRD 4.2 第 5 条）
  replacedBy?: Id;
}

export interface BlobRecord {
  id: Id;
  data: Blob;
}

/* ---------- 生成 ---------- */

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

// 三种生成任务（PRD 5.2）：三视图（用户点按钮）、背景图和合成（都要有效批准）
export type TaskKind = 'view' | 'backdrop' | 'scene';

export interface Task {
  id: Id;
  workId: Id;
  kind: TaskKind;
  approvalId?: Id;
  round?: number; // 背景、合成
  slot?: number;
  view?: ViewAngle; // 三视图的角度
  sourceAssetIds?: Id[]; // 三视图的参考图：第 1 张是这个角度的原图，第 2 张是正面原图
  viewAssetId?: Id; // 三视图任务成功后存下的三视图
  backdropId?: Id; // 背景任务成功后存下的背景图
  attempt: number; // 第几次尝试，补齐时加一
  parentResultId?: Id; // 这一轮是从哪张结果改出来的，结果记为它的子版本
  model: string;
  status: TaskStatus;
  gatewayId?: string;
  ledgerId?: string; // 服务端账本里的记录，内容被拦截不收费时据此退回
  costUSD?: number;
  error?: string;
  notifiedAt?: number | null; // 结束后有没有告诉小间（技术写法 13.12）：null 是还没通知
  createdAt: number;
  updatedAt: number;
}

export type Verdict = 'none' | 'ok' | 'bad';

export interface Result {
  id: Id;
  workId: Id;
  taskId: Id;
  approvalId: Id;
  round: number;
  slot: number;
  blobId: Id;
  thumbId?: Id; // 缩略图，作品页和历史页用
  width: number;
  height: number;
  verdict: { real: Verdict; style: Verdict };
  issues: string[];
  note: string;
  parentId?: Id; // 从哪张结果改出来的（AC-09.4）
  createdAt: number;
  exports: number[];
  published?: number; // 商家说已经拿去发布的时间（AC-10.4：导出与实际发布分开记录）
  verdictAt?: number; // 最近一次改验收、问题标签或说明的时间：停手一会儿再通知小间
  notifiedVerdict?: string; // 已经告诉小间的验收内容（domain/notices.ts 的 verdictKey），变了才再通知
}

/* ---------- 规则判断用的整件作品 ---------- */

// 一件作品的全部数据：界面和小间的工具都从数据库读出这些，再交给 domain/ 的规则函数，判断用同一份
export interface WorkState {
  work: Work;
  assets: readonly Asset[];
  tasks: readonly Task[];
  results: readonly Result[];
  backdrops: readonly Backdrop[]; // 这件作品生成的背景图（候选）
  backdrop: BackdropRef | null; // 选定的背景图；没选或找不到时为空
  backdropApproval: BackdropApproval | null;
  approval: SceneApproval | null;
}

/* ---------- 对话与试用记录 ---------- */

export interface StoredMessage {
  id: Id;
  workId: Id;
  seq: number;
  message: unknown; // AI SDK 的 UI 消息原样保存，含工具调用记录（AC-11.4）
  createdAt: number;
}

// 匿名事件：不存整段聊天和原图（AC-10.4）
export interface TrialEvent {
  id: Id;
  at: number;
  type: string;
  workId?: Id;
  data?: Record<string, string | number | boolean | null>;
}
