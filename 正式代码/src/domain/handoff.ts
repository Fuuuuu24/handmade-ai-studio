import { BACKDROP_MODE_NAMES } from '@/config/backdrops';
import { INFO_CORE, INFO_FIELDS, INFO_KEYS, type InfoKey } from '@/config/info';
import { imageModel } from '@/config/models';
import { FLOW_NAMES, FLOW_STEPS, STEP_NAMES, type Flow, type StepId } from '@/config/steps';
import { BACKDROP_KEYS, NO_PROPS, SCENE_KEYS, STYLE_LABELS } from '@/config/style';
import { VIEW_ANGLES, VIEW_NAMES } from '@/config/views';
import { approvedPhase, backdropApprovalStatus, backdropPromptStatus, sceneApprovalStatus, scenePromptStatus, type ApprovalStatus, type PromptStatus } from './approval';
import { activeUploads, angleNames, angleState, missingAngles } from './assets';
import { backdropDone, paramsText } from './backdrops';
import { busyOf } from './generation';
import { infoLabels, infoMissing, pendingCore } from './info';
import { sceneBasisOf } from './snapshot';
import type { Fact, WorkState } from './types';

/* 「下一步」交接（PRD AC-11.3a，技术写法 13.12）：用户点了「下一步」，浏览器把这一页填了什么、定了什么整理成一条消息
   代用户发给小间。内容由代码按数据生成，不经模型；发出时记下作品快照，之后的变化写进作品状态给小间看（AC-11.3b）。 */

export type HandoffStep = Exclude<StepId, 'result'>;

export const nextStepOf = (flow: Flow, step: StepId): StepId | null => {
  const list = FLOW_STEPS[flow];
  const i = list.indexOf(step);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
};

// 「下一步」能不能点：这一步做完才能交接；不能点时写明缺什么
export function handoffBlocker(s: WorkState, step: HandoffStep): string | null {
  const { work } = s;
  if (step === 'product') {
    const missing = missingAngles(s.assets, work.id);
    if (missing.length) return `还缺${angleNames(missing)}照片`;
    const left = VIEW_ANGLES.filter((a) => !angleState(s.assets, s.tasks, work.id, a).view?.confirmed);
    return left.length ? `${angleNames(left)}的三视图还没确认` : null;
  }
  if (step === 'info') {
    const lack = infoMissing(work.info);
    if (lack.length) return `${infoLabels(lack)}还没填（不知道可以标「未知」）`;
    const pending = pendingCore(work.info);
    return pending.length ? `还有 ${pending.length} 条信息建议没处理` : null;
  }
  if (step === 'backdrop') {
    if (!work.backdropMode) return '还没选背景的做法';
    if (backdropDone(work, s.backdrop)) return null;
    // 选定了、也读得到，却没完成：只会是这件作品自己生成的那张还差共创总结（backdropDone），不看现在是哪种做法
    if (work.backdropId && s.backdrop) return '共创总结还没确认';
    return work.backdropId ? '选定的背景图找不到了' : '还没选定背景图';
  }
  return sceneApprovalStatus(s).kind === 'valid' ? null : '合成方案还没批准';
}

const PROMPT_TEXT: Record<PromptStatus['kind'], string> = {
  missing: '还没写',
  stale: '可能过期',
  unchecked: '手改过，待核对',
  conflict: '和方案有矛盾',
  ok: '有效',
};

const APPROVAL_TEXT: Record<ApprovalStatus['kind'], string> = { none: '还没有', stale: '已失效', valid: '有效' };
const SUMMARY_STATE = { none: '还没有', draft: '草稿', confirmed: '已确认' } as const;

const infoText = (s: WorkState, k: InfoKey) => {
  const f = s.work.info[k];
  return f.unknown ? '未知' : f.value || '未填';
};

// 作品现在的样子，一条条列出来：交接时存一份，之后比一比就知道改了什么
export function factsOf(s: WorkState): Record<string, Fact> {
  const { work } = s;
  const f: Record<string, Fact> = { 流程: { text: FLOW_NAMES[work.flow] } };
  for (const angle of VIEW_ANGLES) {
    const st = angleState(s.assets, s.tasks, work.id, angle);
    const name = VIEW_NAMES[angle];
    f[`${name}照片`] = { text: st.photo ? '有' : '缺', id: st.photo?.id };
    f[`${name}三视图`] = { text: st.view ? (st.view.confirmed ? '已确认' : '待确认') : st.generating ? '生成中' : '还没有', id: st.view?.id };
  }
  const uploads = activeUploads(s.assets, work.id);
  f['细节照'] = { text: `${uploads.filter((a) => a.kind === 'detail').length} 张` };
  f['未分类的照片'] = { text: `${uploads.filter((a) => a.kind === 'unsorted').length} 张` };
  for (const k of INFO_KEYS) {
    f[INFO_FIELDS[k].label] = { text: infoText(s, k) };
    const sug = work.info[k].suggestion;
    if (sug) f[`${INFO_FIELDS[k].label}（你的建议，待用户确认）`] = { text: sug.value };
  }
  f['背景做法'] = { text: work.backdropMode ? BACKDROP_MODE_NAMES[work.backdropMode] : '还没选' };
  f['背景图'] = { text: s.backdrop ? `「${s.backdrop.name}」` : work.backdropId ? '找不到了' : '还没有', id: work.backdropId ?? undefined };
  const sum = work.story.summary;
  f['共创总结'] = { text: sum ? `${SUMMARY_STATE[work.story.summaryState]}：表达「${sum.express}」，感受「${sum.feel}」，避免「${sum.avoid}」` : '还没有' };
  for (const k of [...BACKDROP_KEYS, ...SCENE_KEYS]) f[STYLE_LABELS[k]] = { text: work.style[k].value || '未定' };
  f['合成比例'] = { text: work.ratio };
  f['生图模型'] = { text: imageModel(work.imageModel)?.label ?? work.imageModel };
  f['背景提示词'] = { text: PROMPT_TEXT[backdropPromptStatus(work).kind], id: work.backdropPrompt?.text ?? '' };
  f['合成提示词'] = { text: PROMPT_TEXT[scenePromptStatus(work, sceneBasisOf(work, s.assets)).kind], id: work.prompt?.text ?? '' };
  f['背景批准'] = { text: APPROVAL_TEXT[backdropApprovalStatus(s).kind] };
  f['合成批准'] = { text: APPROVAL_TEXT[sceneApprovalStatus(s).kind] };
  return f;
}

export interface FactChange {
  key: string;
  before: Fact | undefined;
  after: Fact | undefined;
}

export function diffFacts(a: Record<string, Fact>, b: Record<string, Fact>): FactChange[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys
    .filter((k) => a[k]?.text !== b[k]?.text || (a[k]?.id ?? '') !== (b[k]?.id ?? ''))
    .map((key) => ({ key, before: a[key], after: b[key] }));
}

export function changeText(c: FactChange): string {
  const before = c.before?.text ?? '（没有）';
  const after = c.after?.text ?? '（没有）';
  if (before !== after) return `${c.key}：${before} → ${after}`;
  // 文字一样、编号不一样：照片、三视图、背景图换了一张，提示词原文改过
  return c.key.endsWith('提示词') ? `${c.key}改过了（${after}）` : `${c.key}换了一张（${after}）`;
}

const head = (step: HandoffStep) => `【交接：${STEP_NAMES[step]}】用户点了「下一步」，这是「${STEP_NAMES[step]}」这一页现在的内容（系统代发，不是用户原话）：`;

// 交接消息：这一页填了什么、定了什么（技术写法 13.12 第 2 条）
export function handoffText(s: WorkState, step: HandoffStep): string {
  const { work } = s;
  const lines: string[] = [head(step)];
  if (step === 'product') {
    const uploads = activeUploads(s.assets, work.id);
    const angles = VIEW_ANGLES.map((a) => angleState(s.assets, s.tasks, work.id, a));
    lines.push(`- 原图：${angles.map((a) => `${VIEW_NAMES[a.angle]}${a.photo ? '已上传' : '缺'}`).join('、')}；细节照 ${uploads.filter((a) => a.kind === 'detail').length} 张；未分类 ${uploads.filter((a) => a.kind === 'unsorted').length} 张`);
    lines.push(`- 三视图：${angles.map((a) => `${VIEW_NAMES[a.angle]}${a.view ? (a.view.confirmed ? '已确认' : '待确认') : '还没有'}`).join('、')}`);
  } else if (step === 'info') {
    for (const k of INFO_CORE) lines.push(`- ${INFO_FIELDS[k].label}：${infoText(s, k)}${work.info[k].value ? '（已确认）' : ''}`);
    for (const k of INFO_KEYS.filter((x) => !(INFO_CORE as readonly string[]).includes(x))) lines.push(`- ${INFO_FIELDS[k].label}（选填）：${infoText(s, k)}`);
    const pending = INFO_KEYS.filter((k) => work.info[k].suggestion);
    lines.push(`- 还没处理的建议：${pending.length ? pending.map((k) => `${INFO_FIELDS[k].label}「${work.info[k].suggestion!.value}」`).join('、') : '没有'}`);
  } else if (step === 'backdrop') {
    lines.push(`- 做法：${work.backdropMode ? BACKDROP_MODE_NAMES[work.backdropMode] : '还没选'}`);
    const b = s.backdrop;
    if (b) {
      const from = b.builtin ? '内置模板' : b.workId === work.id ? `这件作品生成的，${b.saved ? '已沉淀进模板库' : '没沉淀进模板库'}` : '模板库里沉淀的';
      lines.push(`- 选定的背景图：「${b.name}」（${from}）；参数：${paramsText(b.params)}`);
    } else {
      lines.push('- 选定的背景图：还没有');
    }
    if (work.backdropMode === 'generate') {
      const sum = work.story.summary;
      lines.push(sum ? `- 共创总结（${SUMMARY_STATE[work.story.summaryState]}）：表达「${sum.express}」；感受「${sum.feel || '未写'}」；避免「${sum.avoid || '未写'}」` : '- 共创总结：还没有');
      lines.push(`- 背景风格：${BACKDROP_KEYS.map((k) => `${STYLE_LABELS[k]}「${work.style[k].value || (k === 'props' ? NO_PROPS : '未定')}」`).join('、')}`);
    }
  } else {
    for (const k of SCENE_KEYS) lines.push(`- ${STYLE_LABELS[k]}：${work.style[k].value || (k === 'bannedScene' ? '没写' : '未定')}`);
    lines.push(`- 合成比例：${work.ratio}；生图模型：${imageModel(work.imageModel)?.label ?? work.imageModel}`);
    lines.push(`- 合成提示词：${PROMPT_TEXT[scenePromptStatus(work, sceneBasisOf(work, s.assets)).kind]}`);
    const st = sceneApprovalStatus(s);
    const phase = approvedPhase(s.approval, st, busyOf(s.tasks, work.id).scene);
    const a = s.approval;
    const approval =
      st.kind !== 'valid' || !a
        ? APPROVAL_TEXT[st.kind]
        : phase === 'unused'
          ? `第 ${a.version} 版有效，还没生成`
          : phase === 'generating'
            ? `第 ${a.version} 版有效，第 ${a.usedRound} 轮正在生成`
            : `第 ${a.version} 版有效，已用于第 ${a.usedRound} 轮`;
    lines.push(`- 合成批准：${approval}`);
  }
  return lines.join('\n');
}
