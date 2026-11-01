import { INFO_FIELDS, INFO_KEYS } from '@/config/info';
import type { ChatModel } from '@/config/models';
import { STEPS } from '@/config/steps';
import { NO_PROPS, STYLE_KEYS, STYLE_LABELS } from '@/config/style';
import { ASSET_KINDS } from '@/config/upload';
import { VERDICT_TEXT } from '@/config/verdict';
import { approvalBlockers, approvalStatus, promptStatus } from '@/domain/approval';
import { roundResults, roundSlots, slotState } from '@/domain/generation';
import { activeUploads } from '@/domain/snapshot';
import { currentStep, stepStates, workStatus } from '@/domain/status';
import type { Approval, Asset, Basis, Result, Snapshot, StyleSource, Task, Work } from '@/domain/types';

// 每次对话附给小间的作品状态（技术写法第 6 节）。在浏览器里生成，纯函数，便于测试。

export interface SummaryInput {
  work: Work;
  assets: readonly Asset[];
  approval: Approval | null;
  tasks: readonly Task[];
  results: readonly Result[];
  scenes: readonly { id: string; name: string; desc: string }[];
  basis: Basis;
  current: Snapshot;
  isGenerating: boolean;
  chatModel: ChatModel | null;
  imageModelLabel: string;
}

const SOURCE_TEXT: Record<StyleSource, string> = {
  user: '用户在画布上改的',
  said: '用户说的',
  recommend: '你推荐的，待用户确认',
  scene: '来自布景',
  shop: '来自我的风格',
};

const KIND_TEXT = { inspiration: '灵感', theme: '主题', emotion: '情绪', other: '其他' } as const;

export function stateSummary(i: SummaryInput): string {
  const { work } = i;
  const lines: string[] = [];
  const statusInput = { work, assets: i.assets, tasks: i.tasks, results: i.results, approval: i.approval, current: i.current };
  const steps = stepStates(statusInput);
  const step = STEPS.find((s) => s.id === currentStep(steps))!;
  lines.push(`作品：${work.name}`);
  lines.push(`进度：${workStatus(statusInput).text}；现在该做：${step.name}`);

  const uploads = activeUploads(i.assets, work.id);
  const count = (k: Asset['kind']) => uploads.filter((a) => a.kind === k).length;
  lines.push(
    uploads.length
      ? `照片：${uploads.length} 张（整体 ${count('overall')}、背面 ${count('back')}、细节 ${count('detail')}）；资产${work.assetsConfirmed ? '已确认' : '还没确认'}`
      : '照片：还没有，需要先请用户上传整体照',
  );
  if (uploads.length) lines.push(`照片编号：${uploads.map((a, n) => `${n + 1}. ${a.id}（${ASSET_KINDS[a.kind]}）`).join('；')}`);
  if (work.route === 'A') {
    const whites = i.assets.filter((a) => a.origin === 'white' && !a.removed);
    const making = i.tasks.some((t) => t.kind === 'white' && (t.status === 'queued' || t.status === 'running'));
    const chosen = i.basis.references.includes(work.whiteChoice ?? '');
    lines.push(
      `资产路线：A（先做白底图再生成）；白底图 ${whites.length} 张${making ? '，正在做' : ''}；${chosen ? '已选用一张' : '还没选用，用户要在画布上对照原图后选用'}`,
    );
  } else {
    lines.push('资产路线：B（原图直接作参考图，不需要白底图）');
  }

  lines.push('商品信息：');
  for (const k of INFO_KEYS) {
    const f = work.info[k];
    const state = f.unknown ? '用户标了未知' : f.value ? `${f.value}（已确认）` : '未填';
    const sug = f.suggestion ? `；你的建议「${f.suggestion.value}」待用户确认` : '';
    lines.push(`- ${INFO_FIELDS[k].label}：${state}${sug}`);
  }

  const notes = work.story.notes.slice(-8);
  lines.push(notes.length ? `共创记录：${notes.map((n) => `[${KIND_TEXT[n.kind]}] ${n.text}`).join('；')}` : '共创记录：还没有');
  if (work.story.noStory) lines.push('用户表示暂无明确故事');
  const sum = work.story.summary;
  const sumState = { none: '还没有', draft: '草稿，待用户确认', confirmed: '用户已确认' }[work.story.summaryState];
  lines.push(sum ? `共创总结（${sumState}）：表达「${sum.express}」；感受「${sum.feel || '未写'}」；避免「${sum.avoid || '未写'}」` : `共创总结：${sumState}`);

  lines.push('风格卡：');
  for (const k of STYLE_KEYS) {
    const v = work.style[k];
    const shown = v.value || (k === 'props' && v.source !== 'user' && work.sceneId ? NO_PROPS : '');
    lines.push(`- ${STYLE_LABELS[k]}：${shown ? `${shown}（${SOURCE_TEXT[v.source]}）` : '未定'}`);
  }
  const scene = i.scenes.find((s) => s.id === work.sceneId);
  lines.push(`当前布景：${scene ? `${scene.name}（${scene.id}）` : '没有'}`);
  lines.push(`可用布景：${i.scenes.map((s) => `${s.id} ${s.name}（${s.desc}）`).join('；')}`);
  lines.push(`比例：${work.ratio}；生图模型：${i.imageModelLabel}`);

  const ps = promptStatus(work, i.basis);
  const psText = {
    missing: '还没写',
    stale: ps.kind === 'stale' ? `已过期，写完后改了：${ps.changed.join('、')}，需要重写` : '',
    unchecked: '提示词手改过，待核对（按规则写回风格卡并调用 resolve_prompt_sync）',
    conflict: ps.kind === 'conflict' ? `和方案有矛盾，等用户决定：${ps.conflicts.join('；')}` : '',
    ok: '有效',
  }[ps.kind];
  lines.push(`提示词：${psText}`);
  if (work.prompt?.text) lines.push(`提示词原文：${work.prompt.text}`);

  const ap = approvalStatus(i.approval, i.current);
  if (ap.kind === 'none' || !i.approval) lines.push('批准：还没有');
  else if (ap.kind === 'stale') lines.push(`批准：第 ${i.approval.version} 版已失效，批准后改了：${ap.changed.join('、')}`);
  else lines.push(`批准：第 ${i.approval.version} 版有效${i.approval.usedRound != null ? `，已用于第 ${i.approval.usedRound} 轮生成` : '，还没生成'}`);

  if (work.revision) {
    const from = i.results.find((r) => r.id === work.revision!.fromResultId);
    const reasons = work.revision.reasons.length ? `（用户指出的问题：${work.revision.reasons.join('、')}）` : '';
    lines.push(`正在从${from ? `第 ${from.round} 轮候选 ${from.slot + 1}` : '一张旧结果'}修改${reasons}：方案已恢复成那一版，改好后请用户重新批准`);
  }

  const blockers = approvalBlockers(work, i.assets, i.basis, i.isGenerating);
  lines.push(`批准前还缺：${blockers.length ? blockers.map((b) => b.text).join('；') : '无，可以请用户批准'}`);

  if (work.round > 0) {
    const r = work.round;
    const done = roundResults(i.results, work.id, r);
    const slotText = roundSlots().map((s) => {
      const st = slotState(i.tasks, work.id, r, s);
      const res = done.find((x) => x.slot === s);
      if (res) {
        const v = `${VERDICT_TEXT.real[res.verdict.real]}、${VERDICT_TEXT.style[res.verdict.style]}`;
        return `候选 ${s + 1}：已出图（${v}${res.issues.length ? `；问题：${res.issues.join('、')}` : ''}${res.note ? `；用户说：${res.note}` : ''}）`;
      }
      const lastFail = [...i.tasks].reverse().find((t) => t.round === r && t.slot === s && t.status === 'failed');
      return `候选 ${s + 1}：${{ empty: '未开始', active: '生成中', succeeded: '已完成', failed: `失败（${lastFail?.error ?? '原因未知'}）` }[st]}`;
    });
    lines.push(`第 ${r} 轮生成：${slotText.join('；')}`);
  } else {
    lines.push('生成：还没有');
  }

  const cm = i.chatModel;
  lines.push(`当前对话模型：${cm ? `${cm.label}${cm.vision ? '（能看照片）' : '（看不到照片，需要时请用户描述）'}` : '未知'}`);
  return lines.join('\n');
}
