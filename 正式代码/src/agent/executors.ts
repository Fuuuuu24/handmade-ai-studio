import { INFO_FIELDS } from '@/config/info';
import { builtinScene } from '@/config/scenes';
import type { StepId } from '@/config/steps';
import { STYLE_LABELS } from '@/config/style';
import { getScene } from '@/data/repo';
import { approvalBlockers } from '@/domain/approval';
import { addStoryNote, applyScene, draftSummary, resolvePromptSync, setRatio, setStyle, suggestInfo, writePrompt } from '@/domain/work';
import type { Work } from '@/domain/types';
import { startGeneration } from '@/client/generation';
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

// 生成中锁定方案：改风格、比例、提示词要等这一轮结束（技术写法第 5 节第 7 条）
const LOCKED_WHILE_GENERATING: ToolName[] = ['set_style', 'apply_scene', 'set_ratio', 'draft_prompt', 'resolve_prompt_sync'];

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
      const builtin = builtinScene(sceneId);
      const saved = builtin ? null : await getScene(sceneId);
      const scene = builtin ? { id: builtin.id, name: builtin.name, params: builtin.params } : saved;
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
    case 'show_step': {
      const { step } = rawInput as Input<'show_step'>;
      deps.showStep(step as StepId);
      return done('画布已切换');
    }
    default:
      return refuse(`没有这个工具：${String(name)}`);
  }
}
