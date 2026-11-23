import { INFO_CORE, INFO_FIELDS, INFO_REQUIRED, type InfoKey } from '@/config/info';
import { VIEW_NAMES } from '@/config/views';
import { VERDICT_SHORT } from '@/config/verdict';
import { angleState, currentView } from './assets';
import { backdropCandidates, backdropNameProblem, pickLockProblem, refOfBackdrop, userPickProblem } from './backdrops';
import { busyOf } from './generation';
import { plain } from './said';
import type { Ask, AskAction, AskItem, Id, Work, WorkState } from './types';

/* 小间问过再代点（PRD 4.2 第 2 条，技术写法 14.4）：小间先在对话里列出要替用户点的几样（ask_confirm），
   用户回复同意后小间代点（confirm_for_user）。代码核对三件事：有一条请求在等回复；请求之后用户发过的消息里
   能逐字找到小间引用的原话；要点的东西和问的时候一样。那句话是不是同意的意思由小间理解，代码不判断
   （和 AC-05.1a 核对「你说的」一样），所以卡片上写出它引用的原话。每样能不能点，和画布上的按钮是同一个条件。 */

// 试用记录和卡片上的叫法
export const ACTION_NAMES: Record<AskAction['type'], string> = {
  confirm_view: '三视图',
  accept_info: '接受建议',
  mark_unknown: '标未知',
  confirm_summary: '确认总结',
  pick_backdrop: '选背景',
  save_backdrop: '沉淀',
  verdict: '验收',
  switch_flow: '改流程',
};

const isCore = (k: InfoKey) => (INFO_CORE as readonly InfoKey[]).includes(k);
const isRequired = (k: InfoKey) => (INFO_REQUIRED as readonly InfoKey[]).includes(k);

const candidateOf = (s: WorkState, round: number, candidate: number) =>
  backdropCandidates(s.backdrops, s.work.id, round).find((b) => b.slot === candidate - 1);

const resultOf = (s: WorkState, round: number, candidate: number) =>
  s.results.find((r) => r.workId === s.work.id && r.round === round && r.slot === candidate - 1);

// 那样东西现在的样子：问的时候记一份，代点前再算一份，不一样就说明这期间用户点过、改过，或者又生成了新的。
// target 是问的时候认定的那样东西（沉淀用它，选定背景之后才有）
export function markOf(s: WorkState, a: AskAction, target: Id | null): string {
  const { work } = s;
  switch (a.type) {
    case 'confirm_view': {
      const v = currentView(s.assets, work.id, a.angle);
      return v ? `${v.id}|${!!v.confirmed}` : '';
    }
    case 'accept_info':
    case 'mark_unknown': {
      const f = work.info[a.field];
      return [f.value, f.unknown, f.suggestion?.value ?? '', f.suggestion?.at ?? ''].join('|');
    }
    case 'confirm_summary': {
      const x = work.story.summary;
      return JSON.stringify([work.story.summaryState, x?.express ?? null, x?.feel ?? null, x?.avoid ?? null]);
    }
    case 'pick_backdrop':
      return `${candidateOf(s, a.round, a.candidate)?.id ?? ''}|${work.backdropId ?? ''}`;
    case 'save_backdrop': {
      const b = s.backdrops.find((x) => x.id === target);
      return b ? `${b.id}|${b.savedAt ?? ''}|${b.deletedAt ?? ''}` : '';
    }
    case 'verdict': {
      const r = resultOf(s, a.round, a.candidate);
      return r ? `${r.id}|${r.verdict.real}|${r.verdict.style}` : '';
    }
    case 'switch_flow':
      return `${work.flow}|${work.backdropMode ?? ''}|${work.backdropId ?? ''}`;
  }
}

type Check = { ok: true; text: string; target: Id | null } | { ok: false; reason: string };

const no = (reason: string): Check => ({ ok: false, reason });
const yes = (text: string, target: Id | null = null): Check => ({ ok: true, text, target });

const LOCKED = '正在生成，等这一批结束再问';

// 一样能不能点：和画布上对应的按钮同一个条件。planned 是同一条请求里前面要选定的背景图（先选定再沉淀）
function checkOne(s: WorkState, a: AskAction, planned: Id | null): Check {
  const { work } = s;
  const busy = busyOf(s.tasks, work.id);
  switch (a.type) {
    case 'confirm_view': {
      const name = VIEW_NAMES[a.angle];
      const st = angleState(s.assets, s.tasks, work.id, a.angle);
      if (!st.view) return no(`${name}还没有三视图`);
      if (st.view.confirmed) return no(`${name}三视图已经确认过了`);
      if (st.generating) return no(`${name}三视图正在重做，等新的一张出来再问`);
      return yes(`${name}三视图可以用`, st.view.id);
    }
    case 'accept_info': {
      const label = INFO_FIELDS[a.field].label;
      const sug = work.info[a.field].suggestion;
      if (!sug) return no(`${label}没有待确认的建议`);
      if (isCore(a.field) && (busy.scene || busy.backdrop)) return no(`${LOCKED}（生成中${label}锁定）`);
      return yes(`${label}用建议「${sug.value}」`);
    }
    case 'mark_unknown': {
      const label = INFO_FIELDS[a.field].label;
      const f = work.info[a.field];
      if (!isRequired(a.field)) return no(`只有${INFO_REQUIRED.map((k) => INFO_FIELDS[k].label).join('、')}能标「未知」`);
      if (f.unknown) return no(`${label}已经标了「未知」`);
      if (busy.scene || busy.backdrop) return no(`${LOCKED}（生成中${label}锁定）`);
      return yes(`${label}标「未知」${f.value ? `（现在填的「${f.value}」会清掉）` : ''}`);
    }
    case 'confirm_summary': {
      const sum = work.story.summary;
      if (work.backdropMode !== 'generate') return no('背景用的是模板库里的，没有共创总结要确认');
      if (!sum?.express.trim()) return no('还没有共创总结（至少要写「作品想表达什么」）');
      if (work.story.summaryState === 'confirmed') return no('共创总结已经确认过了');
      if (busy.backdrop || busy.scene) return no(`${LOCKED}（生成中共创总结锁定）`);
      return yes(`确认共创总结：表达「${sum.express}」；感受「${sum.feel || '未写'}」；避免「${sum.avoid || '未写'}」`);
    }
    case 'pick_backdrop': {
      if (work.backdropMode !== 'generate') return no('背景用的是模板库里的；选模板库里的背景用 use_backdrop');
      if (!work.backdropRound) return no('还没有生成过背景');
      const b = candidateOf(s, a.round, a.candidate);
      if (!b) return no(`第 ${a.round} 轮背景 ${a.candidate} 还没有生成出来`);
      // 和画布一样：候选区只显示最新一轮；更早的轮次，沉淀进模板库（没删）的在模板库里能点
      if (a.round !== work.backdropRound && (b.savedAt == null || b.deletedAt != null)) return no(`只能选最新一轮（第 ${work.backdropRound} 轮）的背景，或模板库里沉淀的`);
      if (work.backdropId === b.id) return no(`第 ${a.round} 轮背景 ${a.candidate} 已经选定了`);
      const locked = pickLockProblem(busy);
      if (locked) return no(locked);
      const problem = userPickProblem(refOfBackdrop(b), work);
      if (problem) return no(problem);
      return yes(`用第 ${a.round} 轮背景 ${a.candidate}`, b.id);
    }
    case 'save_backdrop': {
      const problem = backdropNameProblem(a.name);
      if (problem) return no(problem);
      const id = planned ?? work.backdropId;
      if (!id) return no('还没选定背景图，要先选定一张再沉淀');
      const b = s.backdrops.find((x) => x.id === id && x.workId === work.id);
      if (!b) return no('选定的不是这件作品生成的背景图，只有自己生成的才能沉淀进模板库');
      if (b.savedAt != null) return no(`第 ${b.round} 轮背景 ${b.slot + 1} 已经沉淀过了${b.deletedAt ? '（后来从模板库删除了）' : ''}`);
      return yes(`第 ${b.round} 轮背景 ${b.slot + 1} 沉淀进模板库，起名「${a.name.trim()}」`, b.id);
    }
    case 'verdict': {
      const name = `第 ${a.round} 轮候选 ${a.candidate}`;
      if (!a.real && !a.style) return no('验收至少要填一项：real 像不像实物，style 风格对不对');
      const r = resultOf(s, a.round, a.candidate);
      if (!r) return no(`没有${name} 的结果`);
      if ((!a.real || r.verdict.real === a.real) && (!a.style || r.verdict.style === a.style)) return no(`${name} 的验收本来就是这样`);
      const parts = [a.real ? `像实物「${VERDICT_SHORT.real[a.real]}」` : '', a.style ? `风格「${VERDICT_SHORT.style[a.style]}」` : ''].filter(Boolean);
      return yes(`${name} 验收：${parts.join('，')}`, r.id);
    }
    case 'switch_flow': {
      if (work.flow !== 'template') return no('作品已经是首页开始的流程；改背景做法直接用 set_backdrop_mode');
      if (busy.scene || busy.backdrop) return no('正在生成，等结束后再改背景做法');
      return yes('改成自己生成背景：作品改走首页开始的流程，已有的照片、三视图和信息都保留，选的模板会清掉；改了就回不到套用模板的流程');
    }
  }
}

// 同一样不能问两次；同一项信息「接受建议」和「标未知」只能二选一
function sameKey(a: AskAction): string {
  switch (a.type) {
    case 'confirm_view':
      return `view:${a.angle}`;
    case 'accept_info':
    case 'mark_unknown':
      return `info:${a.field}`;
    case 'verdict':
      return `verdict:${a.round}:${a.candidate}`;
    default:
      return a.type;
  }
}

// 一组要替用户点的：按顺序查（前面选定的背景图，后面可以沉淀），全部能点才放卡片；不能点的逐条写原因
export function checkActions(s: WorkState, actions: readonly AskAction[]): { ok: true; items: AskItem[] } | { ok: false; reasons: string[] } {
  const items: AskItem[] = [];
  const reasons: string[] = [];
  const seen = new Set<string>();
  let planned: Id | null = null;
  actions.forEach((a, i) => {
    const key = sameKey(a);
    if (seen.has(key)) return void reasons.push(`第 ${i + 1} 样和前面的重复了`);
    seen.add(key);
    const c = checkOne(s, a, planned);
    if (!c.ok) return void reasons.push(c.reason);
    items.push({ action: a, text: c.text, target: c.target, mark: markOf(s, a, c.target) });
    if (a.type === 'pick_backdrop') planned = c.target;
  });
  return reasons.length ? { ok: false, reasons } : { ok: true, items };
}

// 正在等用户回复的请求（同一时间只有一条）
export const waitingAsk = (w: Work): Ask | undefined => Object.values(w.asks ?? {}).find((a) => a.state === 'waiting');

// 原话前面紧挨着这些字时是在拒绝（「不同意」「不好」「别点」），不算同意。只挡最直白的否定，别的意思仍由小间理解（代码评审 2026-11-23）
const NEGATIONS = new Set(['不', '没', '别', '未', '非', '勿']);

// 用户表示同意的原话：要在请求之后用户发过的消息里逐字找到（去掉空格和标点再比，浏览器代发的交接和通知不算，由调用方排除），
// 而且找到的那一处前面不是否定词
export function consentFound(quote: string, textsAfter: readonly string[]): boolean {
  const q = plain(quote);
  if (!q.length || NEGATIONS.has(q[0])) return false;
  return textsAfter.some((t) => {
    const p = plain(t);
    for (let i = p.indexOf(q); i >= 0; i = p.indexOf(q, i + 1)) if (i === 0 || !NEGATIONS.has(p[i - 1])) return true;
    return false;
  });
}

// 问过之后变了的几样：用户自己点过、改过，或者又生成了新的
export const changedItems = (s: WorkState, items: readonly AskItem[]) => items.filter((it) => markOf(s, it.action, it.target) !== it.mark);
