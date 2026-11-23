import { BACKDROP_MODE_NAMES } from '@/config/backdrops';
import { INFO_FIELDS, INFO_KEYS } from '@/config/info';
import type { ChatModel } from '@/config/models';
import { FLOW_NAMES, STEP_NAMES, stepsOf } from '@/config/steps';
import { BACKDROP_KEYS, NO_PROPS, SCENE_KEYS, STYLE_LABELS, type StyleKey } from '@/config/style';
import { ASSET_KINDS } from '@/config/upload';
import { VIEW_NAMES } from '@/config/views';
import { VERDICT_SHORT } from '@/config/verdict';
import {
  approvalReminders,
  approvedPhase,
  backdropApprovalBlockers,
  backdropApprovalStatus,
  backdropPromptStatus,
  backdropPromptWriteBlocker,
  sceneApprovalBlockers,
  sceneApprovalStatus,
  scenePromptStatus,
  scenePromptWriteBlocker,
  type ApprovalStatus,
  type PromptStatus,
} from '@/domain/approval';
import { activeUploads, angleStates } from '@/domain/assets';
import { backdropCandidates, paramsText } from '@/domain/backdrops';
import { changeText, diffFacts, factsOf } from '@/domain/handoff';
import { lastSlotTask, roundResults, slotsOf, slotState } from '@/domain/generation';
import { currentStep, stepStates, workStatus } from '@/domain/status';
import type { BackdropRef, StyleSource } from '@/domain/types';
import { styleLagsSummary, summaryEdits } from '@/domain/work';
import type { WorkContext } from '@/client/work-store';

// 每次对话附给小间的作品状态（技术写法第 6 节、13.12）。在浏览器里生成，纯函数，便于测试。

export interface SummaryInput extends WorkContext {
  library: readonly BackdropRef[]; // 模板库里可选的背景图
  chatModel: ChatModel | null;
  imageModelLabel: string;
  photoLabels?: readonly string[]; // 这次附上的图各是什么，顺序同附图
  missingPhotos?: readonly string[]; // 本地读不出来、没附上的图
}

const SOURCE_TEXT: Record<StyleSource, string> = {
  user: '用户在画布上改的',
  said: '用户说的',
  recommend: '你推荐的，待用户确认',
};

const KIND_TEXT = { inspiration: '灵感', theme: '主题', emotion: '情绪', other: '其他' } as const;
const SUMMARY_TEXT = { express: '表达', feel: '感受', avoid: '避免' } as const;

const promptText = (ps: PromptStatus, name: string) =>
  ({
    missing: '还没写',
    stale: ps.kind === 'stale' ? `已过期，写完后改了：${ps.changed.join('、')}，需要重写` : '',
    unchecked: `${name}手改过，待核对（按规则写回风格卡并调用 resolve_prompt_sync）`,
    conflict: ps.kind === 'conflict' ? `和方案有矛盾，等用户决定：${ps.conflicts.join('；')}` : '',
    ok: '有效',
  })[ps.kind];

const refText = (r: BackdropRef) =>
  `${r.id} ${r.name}（${r.builtin ? `内置模板${r.placeholder ? '，图还没提供，用色块示意' : ''}` : '用户沉淀的'}；${paramsText(r.params)}）`;

function approvalText(name: string, status: ApprovalStatus, a: { version: number; usedRound: number | null } | null, phase: ReturnType<typeof approvedPhase>, where: string) {
  if (status.kind === 'none' || !a) return `${name}：还没有`;
  if (status.kind === 'stale') return `${name}：第 ${a.version} 版已失效，批准后改了：${status.changed.join('、')}`;
  // 用户可能在小间回复的同时批准并开始了生成：说清楚是这版方案在生成，不要再请用户批准（BC-009）
  if (phase === 'generating') return `${name}：用户已经批准了第 ${a.version} 版，第 ${a.usedRound} 轮正在生成；不需要再请用户批准`;
  if (phase === 'used') return `${name}：第 ${a.version} 版有效，已用于第 ${a.usedRound} 轮；要按同一方案再生成，需要用户在「${where}」里再批准一次`;
  return `${name}：第 ${a.version} 版有效，还没生成`;
}

export function stateSummary(i: SummaryInput): string {
  const { work, busy } = i;
  const lines: string[] = [];
  const steps = stepStates(i);
  const flowSteps = stepsOf(work.flow);
  lines.push(`作品：${work.name}${work.nameSuggestion ? `；你建议的名字「${work.nameSuggestion.value}」待用户在顶栏确认` : ''}`);
  lines.push(`流程：${FLOW_NAMES[work.flow]}（${flowSteps.map((s) => s.name).join(' → ')}）`);
  lines.push(`进度：${workStatus(i).text}；现在该做：${STEP_NAMES[currentStep(i, steps)]}；已完成：${flowSteps.filter((s) => steps[s.id] === 'done').map((s) => s.name).join('、') || '无'}`);
  // 自上次交接以来的变化（AC-11.3b）：包括用户在画布上改的，也包括你用工具改的
  if (work.lastHandoff) {
    const changes = diffFacts(work.lastHandoff.facts, factsOf(i));
    lines.push(
      `上次交接：${STEP_NAMES[work.lastHandoff.step]}；之后有这些变化（你自己用工具改的也算在内）：${changes.length ? changes.map(changeText).join('；') : '没有'}`,
    );
  }

  /* ---------- 商品 ---------- */
  const uploads = activeUploads(i.assets, work.id);
  const angles = angleStates(i.assets, i.tasks, work.id);
  const count = (k: keyof typeof ASSET_KINDS) => uploads.filter((a) => a.kind === k).length;
  lines.push(
    uploads.length
      ? `照片：${angles.map((s) => `${VIEW_NAMES[s.angle]}${s.photo ? '有' : '缺'}`).join('、')}；细节 ${count('detail')} 张${count('unsorted') ? `；未分类 ${count('unsorted')} 张，要用户在「商品」里选类型（你可以建议，不能代选）` : ''}`
      : '照片：还没有，请用户上传正面、侧面、背面三张照片（可以另传细节照）',
  );
  if (uploads.length) lines.push(`照片编号：${uploads.map((a, n) => `${n + 1}. ${a.id}（${ASSET_KINDS[a.kind]}）`).join('；')}`);
  const viewText = angles.map((s) => {
    const name = VIEW_NAMES[s.angle];
    if (!s.photo) return `${name}缺照片`;
    if (s.generating) return `${name}生成中`;
    const failed = s.failed ? `，最近一次没生成出来（${s.failed}）` : '';
    if (!s.view) return `${name}${s.failed ? `没生成出来（${s.failed}）` : '还没生成'}`;
    return `${name}${s.view.confirmed ? '已确认' : '待用户对照原图确认'}${failed}`;
  });
  lines.push(`三视图：${viewText.join('；')}。三张都确认，商品这一步才完成；生成要用户点按钮，你只能用 propose_views 放卡片`);

  /* ---------- 信息 ---------- */
  lines.push('商品信息：');
  for (const k of INFO_KEYS) {
    const f = work.info[k];
    const state = f.unknown ? '用户标了未知' : f.value ? `${f.value}（已确认）` : '未填';
    const sug = f.suggestion ? `；你的建议「${f.suggestion.value}」待用户确认` : '';
    lines.push(`- ${INFO_FIELDS[k].label}：${state}${sug}`);
  }

  /* ---------- 背景 ---------- */
  const mode = BACKDROP_MODE_NAMES[work.backdropMode ?? 'library'];
  lines.push(work.backdropMode ? `背景做法：${mode}` : '背景做法：还没选（请用户在「背景」里选：用模板库里的，或自己生成）');
  const bd = i.backdrop;
  if (bd) {
    const from = bd.builtin ? '内置模板' : bd.workId === work.id ? '这件作品生成的' : '模板库里别的作品沉淀的';
    lines.push(`选定的背景图：${bd.name}（${bd.id}，${from}${bd.deleted ? '，已从模板库删除，这件作品照常可用' : ''}）；参数：${paramsText(bd.params)}`);
  } else if (work.backdropId) {
    lines.push(`选定的背景图找不到了（${work.backdropId}），请用户重新选一张`);
  } else {
    lines.push('选定的背景图：还没有');
  }
  if (work.backdropMode === 'generate' || work.story.summaryState !== 'none') {
    const notes = work.story.notes.slice(-8);
    lines.push(notes.length ? `背景共创记录：${notes.map((n) => `[${KIND_TEXT[n.kind]}] ${n.text}`).join('；')}` : '背景共创记录：还没有');
    if (work.story.noStory) lines.push('用户表示暂无明确故事');
    const sum = work.story.summary;
    const sumState = { none: '还没有', draft: '草稿，待用户确认', confirmed: '用户已确认' }[work.story.summaryState];
    lines.push(sum ? `共创总结（${sumState}）：表达「${sum.express}」；感受「${sum.feel || '未写'}」；避免「${sum.avoid || '未写'}」` : `共创总结：${sumState}`);
    const edits = summaryEdits(work.story);
    if (edits.length) {
      const what = edits.map((e) => `${SUMMARY_TEXT[e.part]}：你写的「${e.drafted || '（空）'}」，用户改成「${e.now || '（空）'}」`).join('；');
      lines.push(`用户改过你起草的总结，以用户的为准，你草稿里被改掉或删掉的说法不要再写进风格和提示词：${what}`);
    }
  }
  if (work.backdropMode === 'generate') {
    if (styleLagsSummary(work)) lines.push('注意：你推荐风格之后，共创总结改过了；按新总结检查背景风格，需要时用 set_style 调整并说明理由');
    lines.push(`背景风格${work.backdropId ? '（背景图已选定，以背景图的参数为准，不能改；想改要用户先点「重新设计背景」）' : ''}：`);
    for (const k of BACKDROP_KEYS) lines.push(styleLine(i, k));
    const round = work.backdropRound;
    if (round > 0) {
      const cands = backdropCandidates(i.backdrops, work.id, round);
      const slots = slotsOf('backdrop').map((s) => {
        const st = slotState(i.tasks, work.id, 'backdrop', round, s);
        const c = cands.find((b) => b.slot === s);
        if (c) return `背景 ${s + 1}：已生成（${c.id}${work.backdropId === c.id ? '，用户选定了这张' : ''}${c.savedAt ? '，已沉淀进模板库' : ''}）`;
        const lastFail = lastSlotTask(i.tasks, work.id, 'backdrop', round, s);
        return `背景 ${s + 1}：${{ empty: '未开始', active: '生成中', succeeded: '已完成', failed: `失败（${lastFail?.error ?? '原因未知'}）` }[st]}`;
      });
      lines.push(`第 ${round} 轮背景：${slots.join('；')}${cands.length && !work.backdropId ? '。选哪张要用户在画布上点「用这张」，你不能代选；图里不能有饰品，请用户把关' : ''}`);
    }
    lines.push(`背景提示词：${promptText(backdropPromptStatus(work, i.backdropBasis), '背景提示词')}`);
    const wait = backdropPromptWriteBlocker(work);
    if (wait && !work.backdropId) lines.push(`写背景提示词前：${wait.text}；现在用 draft_backdrop_prompt 会被拒绝`);
    if (work.backdropPrompt?.text) lines.push(`背景提示词原文：${work.backdropPrompt.text}`);
    const bst = backdropApprovalStatus(i);
    const bphase = approvedPhase(i.backdropApproval, bst, busy.backdrop);
    lines.push(approvalText('背景批准', bst, i.backdropApproval, bphase, '背景'));
    if (!work.backdropId && bphase !== 'generating' && bphase !== 'unused') {
      const bs = backdropApprovalBlockers(i);
      lines.push(`背景批准前还缺：${bs.length ? bs.map((b) => b.text).join('；') : '无，可以请用户批准（request_approval，kind=backdrop）'}`);
    }
  }

  /* ---------- 摆放 ---------- */
  lines.push('摆放卡：');
  for (const k of SCENE_KEYS) lines.push(styleLine(i, k));
  lines.push(`合成比例：${work.ratio}（只有这个比例可选；三视图 1:1、背景 3:4 由系统固定）；生图模型：${i.imageModelLabel}（三视图、背景、合成都用它）`);
  lines.push(`合成提示词：${promptText(scenePromptStatus(work, i.basis), '合成提示词')}`);
  const sceneWait = scenePromptWriteBlocker(i);
  if (sceneWait) lines.push(`写合成提示词前：${sceneWait.text}；现在用 draft_prompt 会被拒绝`);
  if (work.prompt?.text) lines.push(`合成提示词原文：${work.prompt.text}`);
  lines.push('合成参考图：第 1 张是选定的背景图，第 2—4 张是正面、侧面、背面三视图；原图和细节照不进合成');

  const st = sceneApprovalStatus(i);
  const phase = approvedPhase(i.approval, st, busy.scene);
  lines.push(approvalText('合成批准', st, i.approval, phase, '摆放'));
  if (work.revision) {
    const from = i.results.find((r) => r.id === work.revision!.fromResultId);
    const reasons = work.revision.reasons.length ? `（用户指出的问题：${work.revision.reasons.join('、')}）` : '';
    lines.push(`正在从${from ? `第 ${from.round} 轮候选 ${from.slot + 1} ` : '一张旧结果'}修改${reasons}：合成方案已恢复成那一版，改好后请用户重新批准；问题出在背景时，请用户回「背景」换一张或重新生成`);
  }
  // 当前方案已批准、还没生成或正在生成时，没有「批准前还缺」可说（「已有任务在生成中」不是要再批准的理由）
  if (phase !== 'generating' && phase !== 'unused') {
    const bs = sceneApprovalBlockers(i);
    lines.push(`合成批准前还缺：${bs.length ? bs.map((b) => b.text).join('；') : '无，可以请用户批准（request_approval，kind=scene）'}`);
    const reminders = approvalReminders(work);
    if (reminders.length) lines.push(`批准前提醒（不挡批准）：${reminders.map((b) => b.text).join('；')}；请用户在信息页接受或忽略`);
  }

  /* ---------- 出图 ---------- */
  if (work.round > 0) {
    const r = work.round;
    const done = roundResults(i.results, work.id, r);
    const slotText = slotsOf('scene').map((s) => {
      const sst = slotState(i.tasks, work.id, 'scene', r, s);
      const res = done.find((x) => x.slot === s);
      if (res) {
        const v = `像不像实物：${VERDICT_SHORT.real[res.verdict.real]}，风格对不对：${VERDICT_SHORT.style[res.verdict.style]}`;
        return `候选 ${s + 1}：已出图（${v}${res.issues.length ? `；问题：${res.issues.join('、')}` : ''}${res.note ? `；用户说：${res.note}` : ''}）`;
      }
      const lastFail = lastSlotTask(i.tasks, work.id, 'scene', r, s);
      return `候选 ${s + 1}：${{ empty: '未开始', active: '生成中', succeeded: '已完成', failed: `失败（${lastFail?.error ?? '原因未知'}）` }[sst]}`;
    });
    lines.push(`第 ${r} 轮合成：${slotText.join('；')}`);
  } else {
    lines.push('合成：还没有生成');
  }

  lines.push(`模板库里可选的背景图（use_backdrop 用编号）：${i.library.length ? i.library.map(refText).join('；') : '没有'}`);
  if (i.photoLabels?.length) lines.push(`这次附上的图：${i.photoLabels.map((l, n) => `${n + 1}. ${l}`).join('；')}`);
  if (i.missingPhotos?.length) lines.push(`本地读不出来、没附上的图：${i.missingPhotos.join('；')}`);
  const cm = i.chatModel;
  lines.push(`当前对话模型：${cm ? `${cm.label}${cm.vision ? '（能看图）' : '（看不到图，需要时请用户描述）'}` : '未知'}`);
  return lines.join('\n');
}

function styleLine(i: SummaryInput, k: StyleKey): string {
  const v = i.work.style[k];
  const source = v.source === 'said' && v.quote ? `用户说的「${v.quote}」` : SOURCE_TEXT[v.source];
  return `- ${STYLE_LABELS[k]}：${v.value ? `${v.value}（${source}）` : k === 'props' ? `未定（不写就是${NO_PROPS}）` : '未定'}`;
}
