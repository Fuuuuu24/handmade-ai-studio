import { INFO_FIELDS } from '@/config/info';
import { imageModel } from '@/config/models';
import type { StepId } from '@/config/steps';
import { STYLE_LABELS } from '@/config/style';
import { approvalBlockers } from '@/domain/approval';
import { passed } from '@/domain/generation';
import { sceneParamsOf, sceneSaveProblem, shopDiff, shopItemsOf } from '@/domain/library';
import { activeUploads } from '@/domain/snapshot';
import {
  addFollowup,
  addStoryNote,
  applyScene,
  draftSummary,
  resolvePromptSync,
  reviseFrom,
  setImageModel,
  setRatio,
  setStyle,
  suggestInfo,
  suggestName,
  writePrompt,
} from '@/domain/work';
import type { Work } from '@/domain/types';
import { getApproval, getScene, getShopStyle, logEvent, patchResult } from '@/data/repo';
import { makeWhiteByGeneration, retrySlot, startGeneration } from '@/client/generation';
import { findScene } from '@/client/scenes';
import { loadContext, mutateWork, type WorkContext } from '@/client/work-store';
import type { AgentTools, ToolName, ToolOutput } from './tools';
import type { InferToolInput } from 'ai';

/* 小间工具的浏览器端执行器（技术写法第 6 节）。硬规则在这里检查：违反时不执行，把原因作为结果交还模型，
   让它向用户解释（AC-11.5）。这里没有「批准」「确认总结」「同意改长期风格」——这些只在界面按钮里。 */

type Input<N extends ToolName> = InferToolInput<AgentTools[N]>;

export interface ExecDeps {
  showStep: (step: StepId) => void;
}

const refuse = (message: string): ToolOutput => ({ ok: false, message });
const done = (message: string, changes?: string[]): ToolOutput => ({ ok: true, message, changes });

// 生成中锁定方案：改风格、比例、提示词、共创总结要等这一轮结束（技术写法第 5 节第 7 条）
const LOCKED_WHILE_GENERATING: ToolName[] = [
  'draft_summary',
  'set_style',
  'apply_scene',
  'set_ratio',
  'set_image_model',
  'draft_prompt',
  'resolve_prompt_sync',
];

// 工具里的「第几轮候选几」对应到结果
const findResult = (ctx: WorkContext, round: number, candidate: number) =>
  ctx.results.find((r) => r.round === round && r.slot === candidate - 1);

// 修改经 mutateWork 排队执行，读到的总是最新的作品
async function change(workId: string, fn: (ctx: WorkContext) => Work): Promise<void> {
  await mutateWork(workId, fn);
}

export async function executeTool(workId: string, name: ToolName, rawInput: unknown, deps: ExecDeps): Promise<ToolOutput> {
  const ctx = await loadContext(workId);
  if (LOCKED_WHILE_GENERATING.includes(name) && ctx.isGenerating) {
    return refuse('正在生成这一轮候选，方案锁定中；等生成结束后再改');
  }
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
    case 'record_story': {
      const { kind, text } = rawInput as Input<'record_story'>;
      await change(workId, (c) => addStoryNote(c.work, kind, text));
      return done(`已记下：${text}`);
    }
    case 'draft_summary': {
      const sum = rawInput as Input<'draft_summary'>;
      const wasConfirmed = ctx.work.story.summaryState === 'confirmed';
      await change(workId, (c) => draftSummary(c.work, sum));
      return done(
        `已起草共创总结${wasConfirmed ? '（原来确认过的总结回到草稿）' : ''}，在画布上确认或修改后生效`,
        ['共创总结（草稿）'],
      );
    }
    case 'set_style': {
      const { items } = rawInput as Input<'set_style'>;
      await change(workId, (c) =>
        items.reduce((w, it) => setStyle(w, it.field, it.value, it.basis === 'said' ? 'said' : 'recommend', it.reason), c.work),
      );
      const list = items.map((it) => `${STYLE_LABELS[it.field]}「${it.value || '（清空）'}」${it.basis === 'recommend' ? '（推荐，待确认）' : ''}`);
      return done(`风格卡已更新：${list.join('、')}`, list);
    }
    case 'apply_scene': {
      const { sceneId } = rawInput as Input<'apply_scene'>;
      const scene = await findScene(sceneId);
      if (!scene) return refuse(`没有编号为 ${sceneId} 的布景`);
      await change(workId, (c) => applyScene(c.work, scene.id, scene.params));
      return done(`已套用布景「${scene.name}」`, [`布景「${scene.name}」`]);
    }
    case 'set_ratio': {
      const { ratio } = rawInput as Input<'set_ratio'>;
      if (ratio === ctx.work.ratio) return done(`比例本来就是 ${ratio}`);
      await change(workId, (c) => setRatio(c.work, ratio));
      return done(`比例改为 ${ratio}`, [`比例 ${ratio}`]);
    }
    case 'draft_prompt': {
      const { prompt } = rawInput as Input<'draft_prompt'>;
      const after = await mutateWork(workId, (c) => writePrompt(c.work, prompt, c.basis));
      const fresh = await loadContext(workId);
      const left = approvalBlockers(after, fresh.assets, fresh.basis, fresh.isGenerating).filter((b) => !b.text.startsWith('提示词'));
      return done(
        left.length ? `已写好提示词。批准前还缺：${left.map((b) => b.text).join('；')}` : '已写好提示词，可以批准了',
        ['提示词'],
      );
    }
    case 'resolve_prompt_sync': {
      const { conflicts } = rawInput as Input<'resolve_prompt_sync'>;
      if (!ctx.work.prompt?.edited || ctx.work.prompt.sync === 'ok') return refuse('提示词没有待核对的手改');
      await change(workId, (c) => resolvePromptSync(c.work, conflicts, c.basis));
      return done(conflicts.length ? `已标出 ${conflicts.length} 处矛盾，需要你决定` : '核对完成，提示词和方案一致');
    }
    case 'request_approval': {
      const blockers = approvalBlockers(ctx.work, ctx.assets, ctx.basis, ctx.isGenerating);
      return done(
        blockers.length ? `批准卡片已放出，但还缺：${blockers.map((b) => b.text).join('；')}` : '批准卡片已放出，等待确认',
      );
    }
    case 'start_generation': {
      const r = await startGeneration(workId);
      return r.ok ? done(`已开始第 ${r.round} 轮生成，两张候选，通常要等一两分钟`) : refuse(`不能生成：${r.reasons.join('；')}`);
    }
    case 'offer_picks': {
      const { options } = rawInput as Input<'offer_picks'>;
      return done(`已放出 ${options.length} 个方向卡片，等用户挑选`);
    }
    case 'make_white_asset': {
      const { assetId } = rawInput as Input<'make_white_asset'>;
      const id = assetId ?? activeUploads(ctx.assets, workId).find((a) => a.kind === 'overall')?.id;
      if (!id) return refuse('还没有整体照，先请用户上传');
      const r = await makeWhiteByGeneration(workId, id);
      return r.ok ? done('已开始做白底图，通常要一两分钟；做好后请用户在画布上对照原图选用', ['白底图（制作中）']) : refuse(`不能做白底图：${r.reason}`);
    }
    case 'set_image_model': {
      const { model } = rawInput as Input<'set_image_model'>;
      const m = imageModel(model);
      if (!m) return refuse(`没有配置这个生图模型：${model}`);
      if (model === ctx.work.imageModel) return done(`生图模型本来就是 ${m.label}`);
      await change(workId, (c) => setImageModel(c.work, model));
      return done(`生图模型换成 ${m.label}，需要重新批准`, [`生图模型 ${m.label}`]);
    }
    case 'retry_candidate': {
      const { round, candidate } = rawInput as Input<'retry_candidate'>;
      const r = await retrySlot(workId, round, candidate - 1);
      return r.ok ? done(`已重新提交第 ${round} 轮候选 ${candidate}`) : refuse(`不能补齐：${r.reasons.join('；')}`);
    }
    case 'note_feedback': {
      const { round, candidate, issues, note, revise } = rawInput as Input<'note_feedback'>;
      const res = findResult(ctx, round, candidate);
      if (!res) return refuse(`没有第 ${round} 轮候选 ${candidate} 的结果`);
      if (revise && ctx.isGenerating) return refuse('正在生成这一轮，等结束后再从这张修改');
      const approval = revise ? await getApproval(res.approvalId) : undefined;
      if (revise && !approval) return refuse('找不到这张结果当时的方案，不能从它修改');
      await patchResult(res.id, (r) => {
        r.issues = [...new Set([...r.issues, ...issues])];
        if (note?.trim()) r.note = r.note ? `${r.note}；${note.trim()}` : note.trim();
      });
      if (revise && approval) {
        const fresh = { ...res, issues: [...new Set([...res.issues, ...issues])] };
        await change(workId, (c) => reviseFrom(c.work, fresh, approval));
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
      return done('下载卡片已放出，由用户点击下载');
    }
    case 'propose_scene_save': {
      const { name, updateSceneId } = rawInput as Input<'propose_scene_save'>;
      const problem = sceneSaveProblem(sceneParamsOf(ctx.work), name);
      if (problem) return refuse(problem);
      if (updateSceneId && !(await getScene(updateSceneId))) return refuse('只能更新自己存过的布景，内置模版不能改');
      return done('提议卡片已放出，用户确认后才保存');
    }
    case 'propose_shop_style': {
      const { fields } = rawInput as Input<'propose_shop_style'>;
      const diff = shopDiff(await getShopStyle(), shopItemsOf(ctx.work, fields));
      if (!Object.keys(diff).length) return refuse('这几项要么还没定，要么和现在的长期风格一样，不用更新');
      return done('提议卡片已放出，用户同意后才写入我的风格');
    }
    case 'note_followup': {
      const { text } = rawInput as Input<'note_followup'>;
      await change(workId, (c) => addFollowup(c.work, text));
      return done(`已记下这个需求：${text}（本期先不做）`);
    }
    case 'show_step': {
      const { step } = rawInput as Input<'show_step'>;
      deps.showStep(step as StepId);
      return done('画布已切换');
    }
    default:
      return refuse(`没有这个工具：${String(name)}`);
  }
}
