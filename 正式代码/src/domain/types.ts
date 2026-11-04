import type { CoreInfoKey, InfoKey } from '@/config/info';
import type { Ratio } from '@/config/ratios';
import type { StyleKey } from '@/config/style';

export type Id = string;
export type Route = 'A' | 'B'; // A：先做白底再生成；B：原图直接作参考图（PRD 4.3）

/* ---------- 商品信息 ---------- */

// 小间写入的只能是建议，用户接受后才进入 value（PRD 4.2 第 3 条）
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

/* ---------- 共创 ---------- */

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
  summaryState: 'none' | 'draft' | 'confirmed'; // 小间只能写草稿，确认由用户点
  drafted?: StorySummary; // 小间最后一次起草的原文，和 summary 对比就知道用户改了哪几项（BC-003）
}

/* ---------- 风格与布景 ---------- */

// user：用户在画布里改的；said：小间按用户明确说过的写入；recommend：小间推荐，批准方案即确认；scene／shop：来自布景或我的风格
export type StyleSource = 'user' | 'said' | 'recommend' | 'scene' | 'shop';

export interface StyleValue {
  value: string;
  source: StyleSource;
  reason?: string;
}

export type Style = Record<StyleKey, StyleValue>;

export type SceneParams = Record<Exclude<StyleKey, 'expression'>, string>;

export interface SceneVersion {
  version: number;
  name: string;
  params: SceneParams;
  at: number;
}

export interface Scene {
  id: Id;
  name: string;
  params: SceneParams;
  version: number;
  history: SceneVersion[]; // 旧版本，历史方案仍指向当时的参数（AC-06.5）
  createdAt: number;
  updatedAt: number;
}

export interface ShopStyleChange {
  at: number;
  before: Partial<Record<StyleKey, string>>;
  after: Partial<Record<StyleKey, string>>;
  reason: string;
}

// 我的风格：只有用户同意才写入（PRD 4.2 第 2 条）
export interface ShopStyle {
  id: 'me';
  prefs: Partial<Record<StyleKey, string>>;
  history: ShopStyleChange[];
}

/* ---------- 方案、提示词与批准 ---------- */

// 提示词的依据：这些内容一变，提示词就可能过期、批准失效
export interface Basis {
  references: Id[];
  route: Route;
  info: Record<CoreInfoKey, { value: string; unknown: boolean }>;
  summary: StorySummary | null;
  style: Record<StyleKey, string>;
  sceneId: Id | null;
  ratio: Ratio;
  imageModel: string;
}

export interface Snapshot extends Basis {
  prompt: string;
  count: number;
}

// sync：手改提示词后小间核对的结果；unchecked／conflict 时不能批准（技术写法第 5 节第 4 条）
export interface PromptState {
  text: string;
  basis: Basis;
  author: 'agent' | 'user';
  edited: boolean;
  sync: 'ok' | 'unchecked' | 'conflict';
  conflicts: string[];
  original: { text: string; basis: Basis } | null; // 小间写的最后一版，撤销手改时恢复
  at: number;
}

export interface Approval {
  id: Id;
  workId: Id;
  version: number; // 第几版方案
  at: number;
  snapshot: Snapshot;
  usedRound: number | null; // 每次批准只能发起一轮生成
  parentResultId?: Id | null; // 这版方案是从哪张结果改出来的（AC-09.4）
}

// 从某张结果修改（AC-09.4）：记下父结果，以及修改前的方案，取消时恢复
export interface Revision {
  fromResultId: Id;
  reasons: string[]; // 当时验收指出的问题
  prev: Pick<Work, 'style' | 'sceneId' | 'ratio' | 'imageModel' | 'prompt'>;
}

/* ---------- 作品 ---------- */

export interface Work {
  id: Id;
  name: string;
  nameSuggestion?: Suggestion; // 小间起的名字，用户接受后才改名
  createdAt: number;
  updatedAt: number;
  info: Info;
  story: Story;
  style: Style;
  styleSummary?: StorySummary | null; // 小间推荐风格时依据的共创总结；总结之后改了，推荐可能要跟着变（AC-04.6）
  sceneId: Id | null;
  ratio: Ratio;
  imageModel: string;
  chatModel: string;
  route: Route;
  assetsConfirmed: boolean;
  whiteChoice: Id | null; // A 路线选用的白底图
  prompt: PromptState | null;
  approvalId: Id | null; // 最近一次批准
  approvalCount: number;
  round: number; // 已发起的生成轮数
  costUSD: number; // 这件作品累计花费（对话＋生图），试用记录用
  revision?: Revision; // 正在从某张结果修改；开始生成后清掉
  followups?: Followup[]; // 本期不支持、先记下的需求（如真人佩戴，AC-02.5）
  proposals?: Record<Id, 'accepted' | 'declined'>; // 小间提议卡片（存布景、更新我的风格）上用户的决定，按工具调用编号记
}

export interface Followup {
  id: Id;
  text: string;
  at: number;
}

/* ---------- 素材 ---------- */

export type AssetKind = 'overall' | 'back' | 'detail';

export interface Asset {
  id: Id;
  workId: Id;
  origin: 'upload' | 'white';
  kind: AssetKind;
  parentId?: Id; // 白底图的来源图
  method?: 'generate' | 'matting';
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

export interface Task {
  id: Id;
  workId: Id;
  kind: 'scene' | 'white';
  approvalId?: Id;
  round?: number;
  slot?: number;
  sourceAssetId?: Id; // 白底任务的来源图
  whiteAssetId?: Id; // 白底任务成功后存下的白底图
  attempt: number; // 第几次尝试，补齐时加一
  parentResultId?: Id; // 这一轮是从哪张结果改出来的，结果记为它的子版本
  model: string;
  status: TaskStatus;
  gatewayId?: string;
  ledgerId?: string; // 服务端账本里的记录，内容被拦截不收费时据此退回
  costUSD?: number;
  error?: string;
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
  thumbId?: Id; // 缩略图，作品页和历史页用；早期的结果没有，按原图显示
  width: number;
  height: number;
  verdict: { real: Verdict; style: Verdict };
  issues: string[];
  note: string;
  parentId?: Id; // 从哪张结果改出来的（AC-09.4）
  createdAt: number;
  exports: number[];
  published?: number; // 商家说已经拿去发布的时间（AC-10.4：导出与实际发布分开记录）
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
