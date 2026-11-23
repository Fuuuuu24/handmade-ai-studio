import { isBuiltinBackdrop } from '@/config/backdrops';
import type { InfoKey } from '@/config/info';
import type { Ratio } from '@/config/ratios';
import type { StepId } from '@/config/steps';
import { SCENE_KEYS, STYLE_KEYS, type SceneKey, type StyleKey } from '@/config/style';
import {
  backdropApprovalBlockers,
  backdropGenerationBlockers,
  sceneApprovalBlockers,
  sceneGenerationBlockers,
  type Blocker,
} from './approval';
import { backdropModeOf } from './backdrops';
import { emptyInfo } from './info';
import { backdropSnapshotOf, basisOfSceneSnapshot, sceneSnapshotOf } from './snapshot';
import type {
  Backdrop,
  BackdropApproval,
  BackdropBasis,
  BackdropMode,
  BackdropRef,
  Id,
  InfoField,
  PromptBases,
  PromptKind,
  PromptState,
  Result,
  SceneApproval,
  SceneBasis,
  Story,
  StoryNote,
  StorySummary,
  Style,
  StyleSource,
  Work,
  WorkState,
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
  ratio?: Ratio;
  backdropId?: Id | null; // 从模板库「套用」进来：流程二，背景一进来就是这张（PRD 5.2）
}

export function newWork(o: NewWorkOptions): Work {
  const at = Date.now();
  const template = !!o.backdropId;
  return {
    id: newId('work'),
    name: o.name?.trim() || DEFAULT_WORK_NAME,
    createdAt: at,
    updatedAt: at,
    flow: template ? 'template' : 'home',
    info: emptyInfo(),
    story: emptyStory(),
    style: emptyStyle(),
    backdropMode: template ? 'library' : null,
    backdropId: o.backdropId ?? null,
    backdropPrompt: null,
    backdropApprovalId: null,
    backdropApprovalCount: 0,
    backdropRound: 0,
    ratio: o.ratio ?? '1:1',
    imageModel: o.imageModel,
    chatModel: o.chatModel,
    prompt: null,
    approvalId: null,
    approvalCount: 0,
    round: 0,
    costUSD: 0,
  };
}

// 名字清空时保留原名；用户自己改名后，小间的名字建议作废
export const renameWork = (w: Work, name: string) => touch(w, { name: name.trim() || w.name, nameSuggestion: undefined });

// 小间起的名字只是建议，用户接受后才改名（和商品信息一样，PRD 4.2 第 3 条）
export function suggestName(w: Work, name: string, note?: string): Work {
  const v = name.trim();
  if (!v || v === w.name) return w;
  return touch(w, { nameSuggestion: { value: v, note, at: Date.now() } });
}

export const acceptNameSuggestion = (w: Work) => (w.nameSuggestion ? renameWork(w, w.nameSuggestion.value) : w);
export const dismissNameSuggestion = (w: Work) => touch(w, { nameSuggestion: undefined });

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

/* ---------- 共创（背景图的共创） ---------- */

// 同样的内容只记一次：小间续轮时可能把同一批工具再调一遍（BC-007）
export function addStoryNote(w: Work, kind: StoryNote['kind'], text: string): Work {
  const t = text.trim();
  if (!t || w.story.notes.some((n) => n.text === t)) return w;
  const note: StoryNote = { id: newId('note'), kind, text: t, at: Date.now() };
  return touch(w, { story: { ...w.story, notes: [...w.story.notes, note] } });
}

export const setNoStory = (w: Work, noStory: boolean) => touch(w, { story: { ...w.story, noStory } });

// 小间起草：总是草稿，确认由用户点（PRD 4.2 第 3 条、AC-04.4）。和现在的总结一样就不动，
// 免得重复起草把用户的确认打回草稿（BC-007）。drafted 记下小间写的原文，用户改过哪几项可以告诉小间（BC-003）
export function draftSummary(w: Work, summary: StorySummary): Work {
  const s = trimSummary(summary);
  if (w.story.summary && sameSummary(w.story.summary, s)) return w;
  return touch(w, { story: { ...w.story, summary: s, summaryState: 'draft', drafted: s } });
}

const SUMMARY_PARTS = ['express', 'feel', 'avoid'] as const;

// 用户在小间起草的基础上改过的几项：以用户的为准，小间不能再用草稿里被改掉的说法（BC-003）
export function summaryEdits(story: Story): { part: keyof StorySummary; drafted: string; now: string }[] {
  const { summary, drafted } = story;
  if (!summary || !drafted) return [];
  return SUMMARY_PARTS.filter((k) => drafted[k] !== summary[k]).map((k) => ({ part: k, drafted: drafted[k], now: summary[k] }));
}

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

/* ---------- 风格、比例、模型 ---------- */

// 小间推荐时记下依据的共创总结，总结之后改了就能提示风格可能要跟着变（AC-04.6）。
// quote 只在 said 时有：执行器核对过的用户原话（BC-013）
export const setStyle = (w: Work, key: StyleKey, value: string, source: StyleSource, reason?: string, quote?: string) =>
  touch(w, {
    style: { ...w.style, [key]: { value: value.trim(), source, reason, ...(source === 'said' && quote ? { quote } : {}) } },
    ...(source === 'recommend' ? { styleSummary: w.story.summary } : {}),
  });

const sameSummary = (a: StorySummary, b: StorySummary) => a.express === b.express && a.feel === b.feel && a.avoid === b.avoid;

// 小间按某一版总结推荐过风格，之后总结改了
export const styleLagsSummary = (w: Work) =>
  !!w.styleSummary && !!w.story.summary && !sameSummary(w.styleSummary, w.story.summary);

// 用户看过后决定风格不用跟着改
export const keepStyleForSummary = (w: Work) => touch(w, { styleSummary: w.story.summary });

// 只改合成比例：三视图和背景的比例由系统固定（AC-08.1）
export const setRatio = (w: Work, ratio: Ratio) => touch(w, { ratio });

// 换生图模型：已确认的三视图和已选定的背景图不作废，只按快照比对让提示词过期、批准失效（AC-06.7）
export const setImageModel = (w: Work, imageModel: string) => touch(w, { imageModel });
export const setChatModel = (w: Work, chatModel: string) => touch(w, { chatModel });

/* ---------- 背景（技术写法 13.4） ---------- */

// 选背景的做法。换做法时清掉已选的背景图：「自己生成」时不会还挂着模板，选模板也要重新点一张。
// 流程二里改为自己生成时切到流程一（商品还没上传，不能先共创背景），已有的照片、三视图和信息都保留（AC-06.6）
export function setBackdropMode(w: Work, mode: BackdropMode): Work {
  if (w.backdropMode === mode) return w;
  return touch(w, { backdropMode: mode, backdropId: null, flow: mode === 'generate' ? 'home' : w.flow });
}

// 选定一张背景图：画布上点「用这张」、在模板库里点一张、小间的 use_backdrop、「从这一版修改」都走这里。
// 做法跟着背景图的来源走（backdropModeOf，技术写法 13.4），不看是从哪个入口选的。
// 自己生成的背景图只出在流程一（流程二改成自己生成时已经切过来），定为「自己生成」时这里再兜一次底
export function chooseBackdrop(w: Work, ref: Pick<BackdropRef, 'id' | 'builtin' | 'workId'>): Work {
  const mode = backdropModeOf(w, ref);
  if (w.backdropId === ref.id && w.backdropMode === mode) return w;
  return touch(w, { backdropId: ref.id, backdropMode: mode, ...(mode === 'generate' ? { flow: 'home' as const } : {}) });
}

// 「重新设计背景」：放开选定的背景图，背景风格又能改，可以再生成一轮
export const clearBackdrop = (w: Work) => (w.backdropId ? touch(w, { backdropId: null }) : w);

/* ---------- 提示词（背景、合成各一段，写法相同） ---------- */

type PromptOf<K extends PromptKind> = PromptState<PromptBases[K]>;

export const promptOf = <K extends PromptKind>(w: Work, k: K): PromptOf<K> | null =>
  (k === 'backdrop' ? w.backdropPrompt : w.prompt) as PromptOf<K> | null;

const withPrompt = <K extends PromptKind>(w: Work, k: K, p: PromptOf<K> | null): Work =>
  touch(w, k === 'backdrop' ? { backdropPrompt: p as PromptState<BackdropBasis> | null } : { prompt: p as PromptState<SceneBasis> | null });

// 小间写提示词：记下当时的依据（AC-07.2a）
export function writePrompt<K extends PromptKind>(w: Work, k: K, text: string, basis: PromptBases[K]): Work {
  const t = text.trim();
  return withPrompt(w, k, { text: t, basis, author: 'agent', edited: false, sync: 'ok', conflicts: [], original: { text: t, basis }, at: Date.now() });
}

// 用户手改：标「已手动修改」，等小间核对（或用户自己核对）后才能批准
export function editPrompt<K extends PromptKind>(w: Work, k: K, text: string, current: PromptBases[K]): Work {
  const p = promptOf(w, k);
  if (p && text === p.text) return w;
  const base = p ?? { basis: current, original: null };
  return withPrompt(w, k, { ...base, text, author: 'user', edited: true, sync: 'unchecked', conflicts: [], at: Date.now() });
}

// 小间核对手改的结果：没有矛盾时把依据更新为当前状态，避免把用户刚改的提示词判成过期
export function resolvePromptSync<K extends PromptKind>(w: Work, k: K, conflicts: string[], current: PromptBases[K]): Work {
  const p = promptOf(w, k);
  if (!p) return w;
  const list = conflicts.map((c) => c.trim()).filter(Boolean);
  return withPrompt(w, k, { ...p, sync: list.length ? 'conflict' : 'ok', conflicts: list, basis: list.length ? p.basis : current });
}

// 用户并排核对后自己确认一致（小间不可用时也能完成，AC-11.6）
export function markPromptChecked<K extends PromptKind>(w: Work, k: K, current: PromptBases[K]): Work {
  const p = promptOf(w, k);
  return p ? withPrompt(w, k, { ...p, sync: 'ok', conflicts: [], basis: current }) : w;
}

export function revertPrompt<K extends PromptKind>(w: Work, k: K): Work {
  const p = promptOf(w, k);
  const o = p?.original;
  if (!p || !o) return w;
  return withPrompt(w, k, { ...p, text: o.text, basis: o.basis, author: 'agent', edited: false, sync: 'ok', conflicts: [], at: Date.now() });
}

/* ---------- 从指定版本修改（AC-09.4） ---------- */

const sceneStyle = (style: Style) => Object.fromEntries(SCENE_KEYS.map((k) => [k, style[k]])) as Pick<Style, SceneKey>;

// 恢复那一版合成批准时的摆放、背景图、比例、生图模型和提示词；三视图、商品信息、共创总结是作品本身的事实，保持现在的
// （之后改过的话，恢复的提示词会被判为过期）。问题出在背景时回背景这一步重选或重新生成。
// 背景做法跟着恢复的那张背景图走：backdrops 传这件作品生成的背景图（WorkState.backdrops），用来认出是不是自家的
export function reviseFrom(w: Work, result: Result, approval: SceneApproval, backdrops: readonly Backdrop[]): Work {
  const snap = approval.snapshot;
  const text = snap.prompt;
  const basis = basisOfSceneSnapshot(snap);
  const style = { ...w.style };
  for (const k of SCENE_KEYS) {
    const v = snap.style[k] ?? '';
    if (style[k].value !== v) style[k] = { value: v, source: 'user' };
  }
  const prompt: PromptState<SceneBasis> = { text, basis, author: 'agent', edited: false, sync: 'ok', conflicts: [], original: { text, basis }, at: Date.now() };
  // 连着从几张修改时，取消要回到最初的方案
  const prev = w.revision?.prev ?? {
    scene: sceneStyle(w.style),
    backdropId: w.backdropId,
    backdropMode: w.backdropMode,
    ratio: w.ratio,
    imageModel: w.imageModel,
    prompt: w.prompt,
  };
  const id = snap.backdropId;
  const picked = id
    ? chooseBackdrop(w, { id, builtin: isBuiltinBackdrop(id), workId: backdrops.find((b) => b.id === id)?.workId ?? null })
    : touch(w, { backdropId: null });
  return touch(picked, {
    style,
    ratio: snap.ratio,
    imageModel: snap.imageModel,
    prompt,
    revision: { fromResultId: result.id, reasons: [...result.issues], prev },
  });
}

export function cancelRevision(w: Work): Work {
  const r = w.revision;
  if (!r) return w;
  const { scene, ...rest } = r.prev;
  return touch(w, { ...rest, style: { ...w.style, ...scene }, revision: undefined });
}

/* ---------- 批准与生成 ---------- */

export type ApproveResult<A> = { ok: true; work: Work; approval: A } | { ok: false; blockers: Blocker[] };

// 批准只由界面上的用户操作调用；小间的工具里没有批准（PRD 4.2 第 1 条）
export function approveBackdrop(s: WorkState): ApproveResult<BackdropApproval> {
  const blockers = backdropApprovalBlockers(s);
  if (blockers.length) return { ok: false, blockers };
  const w = s.work;
  const approval: BackdropApproval = {
    kind: 'backdrop',
    id: newId('apv'),
    workId: w.id,
    version: w.backdropApprovalCount + 1,
    at: Date.now(),
    snapshot: backdropSnapshotOf(w),
    usedRound: null,
  };
  return { ok: true, work: touch(w, { backdropApprovalId: approval.id, backdropApprovalCount: approval.version }), approval };
}

export function approveScene(s: WorkState): ApproveResult<SceneApproval> {
  const blockers = sceneApprovalBlockers(s);
  if (blockers.length) return { ok: false, blockers };
  const w = s.work;
  const approval: SceneApproval = {
    kind: 'scene',
    id: newId('apv'),
    workId: w.id,
    version: w.approvalCount + 1,
    at: Date.now(),
    snapshot: sceneSnapshotOf(w, s.assets),
    usedRound: null,
    parentResultId: w.revision?.fromResultId ?? null,
  };
  return { ok: true, work: touch(w, { approvalId: approval.id, approvalCount: approval.version }), approval };
}

export type RoundResult<A> = { ok: true; work: Work; approval: A; round: number } | { ok: false; reasons: string[] };

// 发起一轮背景生成：校验有效批准，并把这版批准标为已用
export function startBackdropRound(s: WorkState, approval: BackdropApproval | null): RoundResult<BackdropApproval> {
  const reasons = backdropGenerationBlockers(s, approval);
  if (reasons.length || !approval) return { ok: false, reasons: reasons.length ? reasons : ['背景方案还没批准'] };
  const round = s.work.backdropRound + 1;
  return { ok: true, work: touch(s.work, { backdropRound: round }), approval: { ...approval, usedRound: round }, round };
}

// 发起一轮合成：校验有效批准，并把这版批准标为已用；从结果修改的记录到此结束
export function startSceneRound(s: WorkState, approval: SceneApproval | null): RoundResult<SceneApproval> {
  const reasons = sceneGenerationBlockers(s, approval);
  if (reasons.length || !approval) return { ok: false, reasons: reasons.length ? reasons : ['方案还没批准'] };
  const round = s.work.round + 1;
  return { ok: true, work: touch(s.work, { round, revision: undefined }), approval: { ...approval, usedRound: round }, round };
}

/* ---------- 「下一步」交接（技术写法 13.12） ---------- */

// 用户点了「下一步」：只记「哪一步交接了」，内容在发出那一刻按当时的作品数据生成；同一步排两次只记一次
export const queueHandoff = (w: Work, step: StepId) =>
  w.pendingHandoffs?.includes(step) ? w : touch(w, { pendingHandoffs: [...(w.pendingHandoffs ?? []), step] });

/* ---------- 后续需求与提议卡片 ---------- */

export function addFollowup(w: Work, text: string): Work {
  const t = text.trim();
  if (!t || w.followups?.some((f) => f.text === t)) return w;
  return touch(w, { followups: [...(w.followups ?? []), { id: newId('need'), text: t, at: Date.now() }] });
}

export const removeFollowup = (w: Work, id: Id) => touch(w, { followups: (w.followups ?? []).filter((f) => f.id !== id) });

export const decideProposal = (w: Work, toolCallId: Id, decision: 'accepted' | 'declined') =>
  touch(w, { proposals: { ...w.proposals, [toolCallId]: decision } });

export const addCost = (w: Work, usd: number) => touch(w, { costUSD: Math.round((w.costUSD + usd) * 1e6) / 1e6 });
