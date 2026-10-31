import type { InfoKey } from '@/config/info';
import type { Ratio } from '@/config/ratios';
import { STYLE_KEYS, type StyleKey } from '@/config/style';
import { approvalBlockers, generationBlockers, type Blocker } from './approval';
import { emptyInfo } from './info';
import { basisOfSnapshot } from './snapshot';
import type {
  Approval,
  Asset,
  Basis,
  Id,
  InfoField,
  PromptState,
  Result,
  Route,
  SceneParams,
  Snapshot,
  Story,
  StoryNote,
  StorySummary,
  Style,
  StyleSource,
  Work,
} from './types';
import { newId } from './util';

/* 作品的修改都写成纯函数：传入旧作品，返回新作品。界面和小间的工具执行器都调用这里，
   规则（能不能批准、能不能生成）也在这里检查，不在界面里另写一份。 */

export const emptyStyle = (): Style =>
  Object.fromEntries(STYLE_KEYS.map((k) => [k, { value: '', source: 'user' }])) as Style;

export const emptyStory = (): Story => ({ notes: [], noStory: false, summary: null, summaryState: 'none' });

export const DEFAULT_WORK_NAME = '未命名作品';

const touch = (w: Work, patch: Partial<Work>): Work => ({ ...w, ...patch, updatedAt: Date.now() });

export interface NewWorkOptions {
  name?: string;
  imageModel: string;
  chatModel: string;
  route: Route;
  ratio?: Ratio;
  scene?: { id: Id; params: SceneParams } | null;
}

export function newWork(o: NewWorkOptions): Work {
  const at = Date.now();
  const work: Work = {
    id: newId('work'),
    name: o.name?.trim() || DEFAULT_WORK_NAME,
    createdAt: at,
    updatedAt: at,
    info: emptyInfo(),
    story: emptyStory(),
    style: emptyStyle(),
    sceneId: null,
    ratio: o.ratio ?? '1:1',
    imageModel: o.imageModel,
    chatModel: o.chatModel,
    route: o.route,
    assetsConfirmed: false,
    whiteChoice: null,
    prompt: null,
    approvalId: null,
    approvalCount: 0,
    round: 0,
    costUSD: 0,
  };
  return o.scene ? applyScene(work, o.scene.id, o.scene.params) : work;
}

// 名字清空时保留原名
export const renameWork = (w: Work, name: string) => touch(w, { name: name.trim() || w.name });

/* ---------- 商品信息 ---------- */

const setField = (w: Work, key: InfoKey, field: InfoField) => touch(w, { info: { ...w.info, [key]: field } });

// 用户直接填写：成为已确认的值，同时丢掉待确认建议
export const setInfo = (w: Work, key: InfoKey, value: string) => setField(w, key, { value, unknown: false });

export const markUnknown = (w: Work, key: InfoKey, unknown: boolean) =>
  setField(w, key, unknown ? { value: '', unknown: true } : { value: w.info[key].value, unknown: false });

// 小间只能写建议（PRD 4.2 第 3 条）；和已确认的值相同就不必再建议
export function suggestInfo(w: Work, key: InfoKey, value: string, note?: string): Work {
  const v = value.trim();
  if (!v || v === w.info[key].value) return w;
  return setField(w, key, { ...w.info[key], suggestion: { value: v, note, at: Date.now() } });
}

export function acceptSuggestion(w: Work, key: InfoKey): Work {
  const s = w.info[key].suggestion;
  return s ? setField(w, key, { value: s.value, unknown: false }) : w;
}

export const dismissSuggestion = (w: Work, key: InfoKey) =>
  setField(w, key, { value: w.info[key].value, unknown: w.info[key].unknown });

/* ---------- 共创 ---------- */

export function addStoryNote(w: Work, kind: StoryNote['kind'], text: string): Work {
  const t = text.trim();
  if (!t) return w;
  const note: StoryNote = { id: newId('note'), kind, text: t, at: Date.now() };
  return touch(w, { story: { ...w.story, notes: [...w.story.notes, note] } });
}

export const setNoStory = (w: Work, noStory: boolean) => touch(w, { story: { ...w.story, noStory } });

// 小间起草：总是草稿，确认由用户点（PRD 4.2 第 3 条、AC-04.4）
export const draftSummary = (w: Work, summary: StorySummary) =>
  touch(w, { story: { ...w.story, summary: trimSummary(summary), summaryState: 'draft' } });

// 用户自己改总结：不改变确认状态；原来没有总结时成为草稿
export const editSummary = (w: Work, summary: StorySummary) =>
  touch(w, {
    story: {
      ...w.story,
      summary: trimSummary(summary),
      summaryState: w.story.summaryState === 'none' ? 'draft' : w.story.summaryState,
    },
  });

export const confirmSummary = (w: Work) =>
  w.story.summary ? touch(w, { story: { ...w.story, summaryState: 'confirmed' } }) : w;

const trimSummary = (s: StorySummary): StorySummary => ({
  express: s.express.trim(),
  feel: s.feel.trim(),
  avoid: s.avoid.trim(),
});

/* ---------- 风格、布景、比例、模型 ---------- */

export const setStyle = (w: Work, key: StyleKey, value: string, source: StyleSource, reason?: string) =>
  touch(w, { style: { ...w.style, [key]: { value: value.trim(), source, reason } } });

// 套用布景：只覆盖布景管的几项，「表达」保留
export function applyScene(w: Work, sceneId: Id, params: SceneParams): Work {
  const style = { ...w.style };
  for (const [k, v] of Object.entries(params) as [keyof SceneParams, string][]) style[k] = { value: v, source: 'scene' };
  return touch(w, { style, sceneId });
}

export const setRatio = (w: Work, ratio: Ratio) => touch(w, { ratio });
export const setImageModel = (w: Work, imageModel: string) => touch(w, { imageModel });
export const setChatModel = (w: Work, chatModel: string) => touch(w, { chatModel });

// 换路线要重新确认资产
export const setRoute = (w: Work, route: Route) => (route === w.route ? w : touch(w, { route, assetsConfirmed: false }));

/* ---------- 素材 ---------- */

export const confirmAssets = (w: Work) => touch(w, { assetsConfirmed: true });
export const assetsChanged = (w: Work) => (w.assetsConfirmed ? touch(w, { assetsConfirmed: false }) : w);
export const chooseWhite = (w: Work, assetId: Id | null) => touch(w, { whiteChoice: assetId, assetsConfirmed: false });

/* ---------- 提示词 ---------- */

// 小间写提示词：记下当时的依据（AC-07.2a）
export function writePrompt(w: Work, text: string, basis: Basis): Work {
  const t = text.trim();
  return touch(w, {
    prompt: { text: t, basis, author: 'agent', edited: false, sync: 'ok', conflicts: [], original: { text: t, basis }, at: Date.now() },
  });
}

// 用户手改：标「已手动修改」，等小间核对（或用户自己核对）后才能批准
export function editPrompt(w: Work, text: string, current: Basis): Work {
  if (w.prompt && text === w.prompt.text) return w;
  const base = w.prompt ?? { basis: current, original: null };
  return touch(w, {
    prompt: { ...base, text, author: 'user', edited: true, sync: 'unchecked', conflicts: [], at: Date.now() },
  });
}

// 小间核对手改的结果：没有矛盾时把依据更新为当前状态，避免把用户刚改的提示词判成过期
export function resolvePromptSync(w: Work, conflicts: string[], current: Basis): Work {
  if (!w.prompt) return w;
  const list = conflicts.map((c) => c.trim()).filter(Boolean);
  return touch(w, {
    prompt: { ...w.prompt, sync: list.length ? 'conflict' : 'ok', conflicts: list, basis: list.length ? w.prompt.basis : current },
  });
}

// 用户并排核对后自己确认一致（小间不可用时也能完成，AC-11.6）
export const markPromptChecked = (w: Work, current: Basis) =>
  w.prompt ? touch(w, { prompt: { ...w.prompt, sync: 'ok', conflicts: [], basis: current } }) : w;

export function revertPrompt(w: Work): Work {
  const o = w.prompt?.original;
  if (!w.prompt || !o) return w;
  return touch(w, {
    prompt: { ...w.prompt, text: o.text, basis: o.basis, author: 'agent', edited: false, sync: 'ok', conflicts: [], at: Date.now() },
  });
}

/* ---------- 从指定版本修改（AC-09.4） ---------- */

// 恢复那一版批准时的风格、布景、比例、生图模型和提示词；商品信息、共创总结和照片是作品本身的事实，保持现在的。
// 之后改过商品信息等依据时，恢复的提示词会被判为过期，需要重写或确认
export function reviseFrom(w: Work, result: Result, approval: Approval): Work {
  const text = approval.snapshot.prompt;
  const basis = basisOfSnapshot(approval.snapshot);
  const style = { ...w.style };
  for (const k of STYLE_KEYS) {
    const v = approval.snapshot.style[k] ?? '';
    if (style[k].value !== v) style[k] = { value: v, source: 'user' };
  }
  const prompt: PromptState = { text, basis, author: 'agent', edited: false, sync: 'ok', conflicts: [], original: { text, basis }, at: Date.now() };
  // 连着从几张修改时，取消要回到最初的方案
  const prev = w.revision?.prev ?? { style: w.style, sceneId: w.sceneId, ratio: w.ratio, imageModel: w.imageModel, prompt: w.prompt };
  return touch(w, {
    style,
    sceneId: approval.snapshot.sceneId,
    ratio: approval.snapshot.ratio,
    imageModel: approval.snapshot.imageModel,
    prompt,
    revision: { fromResultId: result.id, reasons: [...result.issues], prev },
  });
}

export const cancelRevision = (w: Work) => (w.revision ? touch(w, { ...w.revision.prev, revision: undefined }) : w);

/* ---------- 批准与生成 ---------- */

export type ApproveResult = { ok: true; work: Work; approval: Approval } | { ok: false; blockers: Blocker[] };

// 批准只由界面上的用户操作调用；小间的工具里没有批准（PRD 4.2 第 1 条）
export function approve(w: Work, assets: readonly Asset[], current: Snapshot, isGenerating: boolean): ApproveResult {
  const blockers = approvalBlockers(w, assets, current, isGenerating);
  if (blockers.length) return { ok: false, blockers };
  const approval: Approval = {
    id: newId('apv'),
    workId: w.id,
    version: w.approvalCount + 1,
    at: Date.now(),
    snapshot: current,
    usedRound: null,
    parentResultId: w.revision?.fromResultId ?? null,
  };
  return { ok: true, work: touch(w, { approvalId: approval.id, approvalCount: approval.version }), approval };
}

export type RoundResult = { ok: true; work: Work; approval: Approval; round: number } | { ok: false; reasons: string[] };

// 发起一轮生成：校验有效批准，并把这版批准标为已用
export function startRound(w: Work, approval: Approval | null, current: Snapshot, isGenerating: boolean): RoundResult {
  const reasons = generationBlockers(approval, current, isGenerating);
  if (reasons.length || !approval) return { ok: false, reasons: reasons.length ? reasons : ['方案还没批准'] };
  const round = w.round + 1;
  return { ok: true, work: touch(w, { round, revision: undefined }), approval: { ...approval, usedRound: round }, round };
}

export const addCost = (w: Work, usd: number) => touch(w, { costUSD: Math.round((w.costUSD + usd) * 1e6) / 1e6 });
