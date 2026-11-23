import type { InferToolInput } from 'ai';
import { BACKDROP_MODE_NAMES } from '@/config/backdrops';
import { INFO_FIELDS } from '@/config/info';
import { imageModel } from '@/config/models';
import { isStepId, type StepId } from '@/config/steps';
import { isBackdropKey, STYLE_LABELS } from '@/config/style';
import {
  approvalReminders,
  approvedPhase,
  backdropApprovalBlockers,
  backdropApprovalStatus,
  backdropPromptWriteBlocker,
  PROMPT_NAMES,
  sceneApprovalBlockers,
  sceneApprovalStatus,
  scenePromptWriteBlocker,
  type Blocker,
} from '@/domain/approval';
import { angleNames, anglesToGenerate, viewCheck } from '@/domain/assets';
import { agentPickProblem, ownBackdrop } from '@/domain/backdrops';
import { passed } from '@/domain/generation';
import { saidQuoteFound } from '@/domain/said';
import type { Work } from '@/domain/types';
import {
  addFollowup,
  addStoryNote,
  chooseBackdrop,
  draftSummary,
  promptOf,
  resolvePromptSync,
  reviseFrom,
  setImageModel,
  setRatio,
  setStyle,
  suggestInfo,
  suggestName,
  writePrompt,
} from '@/domain/work';
import { getSceneApproval, logEvent, patchResult } from '@/data/repo';
import { retrySlot, startBackdropGeneration, startGeneration } from '@/client/generation';
import { loadContext, mutateWork, resolveBackdrop, type WorkContext } from '@/client/work-store';
import type { AgentTools, ToolName, ToolOutput } from './tools';

/* 小间工具的浏览器端执行器（技术写法第 6 节、13.7）。硬规则在这里检查：违反时不执行，把原因作为结果交还模型，
   让它向用户解释（AC-11.5）。这里没有「批准」「确认总结」「确认三视图」「选定背景候选」「沉淀或删除背景图」——这些只在界面按钮里。 */

type Input<N extends ToolName> = InferToolInput<AgentTools[N]>;

export interface ExecDeps {
  showStep: (step: StepId) => void;
  userTexts: () => readonly string[]; // 用户在对话里发过的文字（不含系统代发的交接和通知），核对「你说的」用（BC-013）
}

const refuse = (message: string): ToolOutput => ({ ok: false, message });
const done = (message: string, changes?: string[]): ToolOutput => ({ ok: true, message, changes });

// 生成中锁定方案（技术写法 13.6）：合成生成中锁合成快照里的内容，背景生成中锁背景快照里的内容
export const LOCK_SCENE = '正在生成这一轮候选，方案锁定中；等生成结束后再改';
export const LOCK_BACKDROP = '背景正在生成中，背景方案锁定；等两张背景出来后再改';
const BACKDROP_PICKED = '已经选定了背景图，背景五项以背景图记录的参数为准、不能改；想换的话请用户在「背景」里点「重新设计背景」，再生成新的';

// 工具里的「第几轮候选几」对应到结果
const findResult = (ctx: WorkContext, round: number, candidate: number) =>
  ctx.results.find((r) => r.round === round && r.slot === candidate - 1);

// 修改经 mutateWork 排队执行，读到的总是最新的作品；返回改完的作品
const change = (workId: string, fn: (ctx: WorkContext) => Work): Promise<Work> => mutateWork(workId, fn);

const listText = (bs: readonly Blocker[]) => bs.map((b) => b.text).join('；');

// 写提示词前核心信息的建议要先处理完（UX-02）：同一轮里先写建议再写提示词，用户一接受，提示词就过期
const infoWait = (name: string, b: Blocker) =>
  `没写${name}：${b.text}。请用户先在「信息」里接受或忽略，处理完再写；现在写的话，一接受建议提示词就过期了`;

export async function executeTool(workId: string, name: ToolName, rawInput: unknown, deps: ExecDeps): Promise<ToolOutput> {
  const ctx = await loadContext(workId);
  const { busy } = ctx;
  switch (name) {
    case 'update_info': {
      const { items } = rawInput as Input<'update_info'>;
      await change(workId, (c) => items.reduce((w, it) => suggestInfo(w, it.field, it.value, it.note), c.work));
      const list = items.map((it) => `${INFO_FIELDS[it.field].label}「${it.value}」`);
      return done(`已写成待确认建议：${list.join('、')}（在画布上接受后才生效）`, list);
    }
    case 'suggest_name': {
      const { name: n, note } = rawInput as Input<'suggest_name'>;
      if (n.trim() === ctx.work.name) return done(`作品本来就叫「${ctx.work.name}」`);
      await change(workId, (c) => suggestName(c.work, n, note));
      return done(`已写成名字建议「${n.trim()}」，用户在顶栏接受后才改名`, [`名字建议「${n.trim()}」`]);
    }
    case 'propose_views': {
      const { angles } = rawInput as Input<'propose_views'>;
      const list = angles?.length ? [...new Set(angles)] : anglesToGenerate(ctx.assets, ctx.tasks, workId);
      const check = viewCheck(ctx.assets, ctx.tasks, workId, list, busy);
      if (!check.ok) return refuse(`不能生成三视图：${check.reason}`);
      return done(`「生成三视图」卡片已放出（${angleNames(list)}），用户点了才生成，每张要花一张图的钱；生成后请用户逐张对照原图确认`);
    }
    case 'record_story': {
      const { kind, text } = rawInput as Input<'record_story'>;
      let added = false;
      await change(workId, (c) => {
        const w = addStoryNote(c.work, kind, text);
        added = w !== c.work;
        return w;
      });
      return done(added ? `已记下：${text}` : `这一条之前已经记下了，没有重复记录：${text}`);
    }
    case 'draft_summary': {
      // 共创总结在背景和合成两种快照里都有
      if (busy.scene) return refuse(LOCK_SCENE);
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      const sum = rawInput as Input<'draft_summary'>;
      let changed = false;
      let wasConfirmed = false;
      await change(workId, (c) => {
        wasConfirmed = c.work.story.summaryState === 'confirmed';
        const w = draftSummary(c.work, sum);
        changed = w !== c.work;
        return w;
      });
      if (!changed) return done(`总结和现在的一样，没有改动（仍是${wasConfirmed ? '用户确认过的' : '草稿'}）`);
      return done(`已起草共创总结${wasConfirmed ? '（原来确认过的总结回到草稿）' : ''}，在画布上确认或修改后生效`, ['共创总结（草稿）']);
    }
    case 'set_style': {
      const { items } = rawInput as Input<'set_style'>;
      const touchesBackdrop = items.some((it) => isBackdropKey(it.field));
      const touchesScene = items.some((it) => !isBackdropKey(it.field));
      if (touchesScene && busy.scene) return refuse(LOCK_SCENE);
      if (touchesBackdrop && busy.backdrop) return refuse(LOCK_BACKDROP);
      if (touchesBackdrop && ctx.work.backdropId) return refuse(BACKDROP_PICKED);
      // 「你说的」要能在用户原话里找到小间附的片段，找不到就记为「小间推荐」（BC-013）
      const texts = deps.userTexts();
      const prompts = [ctx.work.prompt, ctx.work.backdropPrompt];
      const checked = items.map((it) => {
        const said = it.basis === 'said' && saidQuoteFound(it.quote, texts, prompts);
        return { ...it, said, downgraded: it.basis === 'said' && !said };
      });
      await change(workId, (c) =>
        checked.reduce((w, it) => setStyle(w, it.field, it.value, it.said ? 'said' : 'recommend', it.reason, it.said ? it.quote?.trim() : undefined), c.work),
      );
      const list = checked.map((it) => `${STYLE_LABELS[it.field]}「${it.value || '（清空）'}」${it.said ? '' : '（推荐，待确认）'}`);
      const down = checked.filter((it) => it.downgraded);
      const note = down.length
        ? `。其中${down.map((it) => `${STYLE_LABELS[it.field]}${it.quote?.trim() ? `（「${it.quote.trim()}」）` : '（没附原话）'}`).join('、')}在用户的原话里没找到，已记为「小间推荐」，是建议、不是用户说的`
        : '';
      return done(`风格卡已更新：${list.join('、')}${note}`, list);
    }
    case 'use_backdrop': {
      // 两种生成进行中都不能换背景：合成时背景图锁进了快照；背景生成时两张出来要在候选区里选（技术写法 13.6）
      const { backdropId } = rawInput as Input<'use_backdrop'>;
      if (busy.scene) return refuse(LOCK_SCENE);
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      const ref = await resolveBackdrop(backdropId);
      const problem = agentPickProblem(ref, backdropId);
      if (problem) return refuse(problem);
      const b = ref!;
      const before = ctx.work.backdropMode;
      let changed = false;
      const w = await change(workId, (c) => {
        const next = chooseBackdrop(c.work, b);
        changed = next !== c.work;
        return next;
      });
      if (!changed) return done(`背景本来就是「${b.name}」`);
      const own = ownBackdrop(w, b);
      void logEvent(own ? 'pick_backdrop' : 'use_template', workId, { builtin: b.builtin, by: 'agent' });
      const from = b.builtin ? '内置模板，暂无参数' : own ? '这件作品生成的' : '模板库里沉淀的';
      const mode = BACKDROP_MODE_NAMES[w.backdropMode!];
      const modeText = before === w.backdropMode ? `背景做法仍是「${mode}」` : `背景做法${before ? `从「${BACKDROP_MODE_NAMES[before]}」` : ''}换成了「${mode}」`;
      return done(`已选用背景图「${b.name}」（${from}）；${modeText}`, [`背景图「${b.name}」`]);
    }
    case 'draft_backdrop_prompt': {
      const { prompt } = rawInput as Input<'draft_backdrop_prompt'>;
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      const wait = backdropPromptWriteBlocker(ctx.work);
      if (wait) return refuse(wait.step === 'info' ? infoWait(PROMPT_NAMES.backdrop, wait) : `没写${PROMPT_NAMES.backdrop}：${wait.text}`);
      await mutateWork(workId, (c) => writePrompt(c.work, 'backdrop', prompt, c.backdropBasis));
      const left = backdropApprovalBlockers(await loadContext(workId)).filter((b) => !b.text.startsWith(PROMPT_NAMES.backdrop));
      return done(left.length ? `已写好背景提示词。批准前还缺：${listText(left)}` : '已写好背景提示词，可以请用户批准了', [PROMPT_NAMES.backdrop]);
    }
    case 'start_backdrop_generation': {
      const r = await startBackdropGeneration(workId);
      return r.ok ? done(`已开始第 ${r.round} 轮背景生成，两张，通常要等一两分钟；出来后请用户选一张`) : refuse(`不能生成背景：${r.reasons.join('；')}`);
    }
    case 'set_ratio': {
      const { ratio } = rawInput as Input<'set_ratio'>;
      if (busy.scene) return refuse(LOCK_SCENE);
      if (ratio === ctx.work.ratio) return done(`合成比例本来就是 ${ratio}`);
      await change(workId, (c) => setRatio(c.work, ratio));
      return done(`合成比例改为 ${ratio}`, [`比例 ${ratio}`]);
    }
    case 'draft_prompt': {
      const { prompt } = rawInput as Input<'draft_prompt'>;
      if (busy.scene) return refuse(LOCK_SCENE);
      const wait = scenePromptWriteBlocker(ctx);
      if (wait) return refuse(wait.step === 'info' ? infoWait(PROMPT_NAMES.scene, wait) : `没写${PROMPT_NAMES.scene}：${wait.text}`);
      await mutateWork(workId, (c) => writePrompt(c.work, 'scene', prompt, c.basis));
      const left = sceneApprovalBlockers(await loadContext(workId)).filter((b) => !b.text.startsWith(PROMPT_NAMES.scene));
      return done(left.length ? `已写好合成提示词。批准前还缺：${listText(left)}` : '已写好合成提示词，可以请用户批准了', [PROMPT_NAMES.scene]);
    }
    case 'resolve_prompt_sync': {
      const { which, conflicts } = rawInput as Input<'resolve_prompt_sync'>;
      if (which === 'scene' && busy.scene) return refuse(LOCK_SCENE);
      if (which === 'backdrop' && busy.backdrop) return refuse(LOCK_BACKDROP);
      const p = promptOf(ctx.work, which);
      if (!p?.edited || p.sync === 'ok') return refuse(`${PROMPT_NAMES[which]}没有待核对的手改`);
      await change(workId, (c) =>
        which === 'backdrop' ? resolvePromptSync(c.work, 'backdrop', conflicts, c.backdropBasis) : resolvePromptSync(c.work, 'scene', conflicts, c.basis),
      );
      return done(conflicts.length ? `已标出 ${conflicts.length} 处矛盾，需要用户决定` : `核对完成，${PROMPT_NAMES[which]}和方案一致`);
    }
    case 'request_approval': {
      const { kind } = rawInput as Input<'request_approval'>;
      const reminders = approvalReminders(ctx.work);
      const remind = reminders.length ? `。卡片上同时提醒（不挡批准）：${listText(reminders)}` : '';
      if (kind === 'backdrop') {
        if (ctx.work.backdropMode !== 'generate') return refuse('背景用的是模板库里的，不需要背景批准');
        // 小间回复的同时，用户可能已经在画布上批准并开始生成了（BC-009）
        const a = ctx.backdropApproval;
        const phase = approvedPhase(a, backdropApprovalStatus(ctx), busy.backdrop);
        if (phase === 'generating') return done(`用户已经批准了背景方案（第 ${a!.version} 版），第 ${a!.usedRound} 轮背景正在生成，不需要再批准；出来后请用户选一张`);
        if (phase === 'used') return done(`背景方案已经批准过（第 ${a!.version} 版）并生成了第 ${a!.usedRound} 轮；要再生成一轮，需要用户在「背景」里再批准一次`);
        if (phase === 'unused') return done(`背景方案已经批准（第 ${a!.version} 版），还没生成；用户要生成时用 start_backdrop_generation，不需要再批准`);
        const bs = backdropApprovalBlockers(ctx);
        return done((bs.length ? `背景批准卡片已放出，但还缺：${listText(bs)}` : '背景批准卡片已放出，等待确认') + remind);
      }
      const a = ctx.approval;
      const phase = approvedPhase(a, sceneApprovalStatus(ctx), busy.scene);
      if (phase === 'generating') return done(`用户已经批准了当前方案（第 ${a!.version} 版），第 ${a!.usedRound} 轮正在生成，不需要再批准；等结果出来请用户验收`);
      if (phase === 'used') return done(`当前方案已经批准过（第 ${a!.version} 版）并生成了第 ${a!.usedRound} 轮；要按同一方案再生成一轮，需要用户在「摆放」里再批准一次`);
      if (phase === 'unused') return done(`当前方案已经批准（第 ${a!.version} 版），还没生成；用户要生成时用 start_generation，不需要再批准`);
      const bs = sceneApprovalBlockers(ctx);
      return done((bs.length ? `批准卡片已放出，但还缺：${listText(bs)}` : '批准卡片已放出，等待确认') + remind);
    }
    case 'start_generation': {
      const r = await startGeneration(workId);
      return r.ok ? done(`已开始第 ${r.round} 轮生成，两张候选，通常要等一两分钟`) : refuse(`不能生成：${r.reasons.join('；')}`);
    }
    case 'offer_picks': {
      const { options } = rawInput as Input<'offer_picks'>;
      return done(`已放出 ${options.length} 个方向卡片，等用户挑选`);
    }
    case 'set_image_model': {
      const { model } = rawInput as Input<'set_image_model'>;
      if (ctx.anyGenerating) return refuse('正在生成，等这一批结束后再换生图模型');
      const m = imageModel(model);
      if (!m) return refuse(`没有配置这个生图模型：${model}`);
      if (model === ctx.work.imageModel) return done(`生图模型本来就是 ${m.label}`);
      await change(workId, (c) => setImageModel(c.work, model));
      return done(`生图模型换成 ${m.label}；已确认的三视图和选定的背景图照常可用，方案需要重新批准`, [`生图模型 ${m.label}`]);
    }
    case 'retry_candidate': {
      const { kind, round, candidate } = rawInput as Input<'retry_candidate'>;
      const r = await retrySlot(workId, kind, round, candidate - 1);
      return r.ok ? done(`已重新提交第 ${round} 轮${kind === 'backdrop' ? '背景' : '候选'} ${candidate}`) : refuse(`不能补齐：${r.reasons.join('；')}`);
    }
    case 'note_feedback': {
      const { round, candidate, issues, note, revise } = rawInput as Input<'note_feedback'>;
      const res = findResult(ctx, round, candidate);
      if (!res) return refuse(`没有第 ${round} 轮候选 ${candidate} 的结果`);
      if (revise && busy.scene) return refuse('正在生成这一轮，等结束后再从这张修改');
      const approval = revise ? await getSceneApproval(res.approvalId) : undefined;
      if (revise && !approval) return refuse('找不到这张结果当时的方案，不能从它修改');
      await patchResult(res.id, (r) => {
        r.issues = [...new Set([...r.issues, ...issues])];
        if (note?.trim()) r.note = r.note ? `${r.note}；${note.trim()}` : note.trim();
      });
      if (revise && approval) {
        const fresh = { ...res, issues: [...new Set([...res.issues, ...issues])] };
        await change(workId, (c) => reviseFrom(c.work, fresh, approval, c.backdrops));
        void logEvent('revise', workId, { round, slot: candidate - 1, by: 'agent' });
      }
      const what = [issues.length ? `问题：${issues.join('、')}` : '', note?.trim() ? `说明：${note.trim()}` : ''].filter(Boolean).join('；');
      return done(
        `已记在第 ${round} 轮候选 ${candidate} 上${what ? `（${what}）` : ''}${revise ? '；方案已恢复成那一版，改好后请用户重新批准' : ''}。验收结果仍由用户在画布上点`,
      );
    }
    case 'offer_export': {
      const { round, candidate } = rawInput as Input<'offer_export'>;
      const res = findResult(ctx, round, candidate);
      if (!res) return refuse(`没有第 ${round} 轮候选 ${candidate} 的结果`);
      if (!passed(res)) return refuse('这张还没有两项都验收满意，不能导出；请用户先在画布上验收');
      return done('下载卡片已放出，由用户点击下载；卡片上提醒了发布时按平台要求声明是 AI 生成的图');
    }
    case 'note_followup': {
      const { text } = rawInput as Input<'note_followup'>;
      await change(workId, (c) => addFollowup(c.work, text));
      return done(`已记下这个需求：${text}（本期先不做）`);
    }
    case 'show_step': {
      const { step } = rawInput as Input<'show_step'>;
      if (!isStepId(step)) return refuse(`没有这一步：${String(step)}`);
      deps.showStep(step);
      return done('画布已切换');
    }
    default:
      return refuse(`没有这个工具：${String(name)}`);
  }
}
