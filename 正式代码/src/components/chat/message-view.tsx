'use client';

import { isToolUIPart, getToolName } from 'ai';
import type { AgentUIMessage, ToolName, ToolOutput } from '@/agent/tools';
import { useBlobUrl } from '@/client/hooks';
import { useWorkspace } from '@/components/workspace/context';
import { Icon } from '@/components/ui/icon';
import { ApprovalCard } from './approval-card';
import { RichText } from './rich-text';
import { AskCard, ExportCard, PicksCard, RetryCard, ViewsCard } from './tool-cards';
import ThoughtLine from '@/components/bits/ThoughtLine/ThoughtLine';

const TOOL_DOING: Record<ToolName, string> = {
  update_info: '整理商品信息',
  rename_work: '改作品名',
  set_photo_kind: '给照片分类',
  propose_views: '准备生成三视图',
  record_story: '记下你说的',
  draft_summary: '起草共创总结',
  set_style: '调整风格',
  set_backdrop_mode: '换背景的做法',
  use_backdrop: '选用模板库里的背景',
  redesign_backdrop: '放开选定的背景',
  rename_backdrop: '给背景图改名',
  draft_backdrop_prompt: '写背景提示词',
  set_ratio: '设置比例',
  draft_prompt: '写合成提示词',
  resolve_prompt_sync: '核对手改的提示词',
  request_approval: '准备批准卡片',
  propose_retry: '准备补齐',
  offer_picks: '准备几个方向',
  set_image_model: '换生图模型',
  note_feedback: '记下你的意见',
  offer_export: '准备下载',
  note_followup: '记下后续需求',
  ask_confirm: '准备问你',
  confirm_for_user: '替你点',
  next_step: '推进到下一步',
  show_step: '切换画布',
  request_delete: '等你确认',
};
const doing = (name: string) => TOOL_DOING[name as ToolName] ?? name;

function PhotoThumb({ assetId }: { assetId: string }) {
  const { ctx } = useWorkspace();
  const asset = ctx.assets.find((a) => a.id === assetId);
  const url = useBlobUrl(asset?.thumbId);
  if (!asset) return <span className="text-label text-muted">（照片已移除）</span>;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- 本地数据库里的图片，不经过 next/image
    <img src={url} alt="上传的作品照片" className="size-[88px] rounded-lg object-cover shadow-[0_0_0_1px_var(--color-line)]" />
  ) : (
    <span className="block size-[88px] rounded-lg bg-soft" />
  );
}

// 小间每次调用工具，在对话里留一行记录：做了什么、改了哪些（AC-11.4）
function ToolRecord({ part }: { part: AgentUIMessage['parts'][number] }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  if (name === 'show_step') return null;
  if (part.state === 'output-error') {
    return <p className="text-aux text-bad">小间{doing(name)}时出错：{part.errorText}</p>;
  }
  if (part.state !== 'output-available') {
    return (
      <p className="flex items-center gap-1.5 text-aux text-muted">
        <span className="spinner !size-3" aria-hidden="true" />
        正在{doing(name)}…
      </p>
    );
  }
  const out = part.output as ToolOutput;
  // 推进下一步的结果里带着整页内容（给小间看的），对话里只记推进到了哪一步
  const text = name === 'next_step' && out.ok ? (out.changes?.[0] ?? out.message.split('\n')[0]) : out.message;
  return (
    <p className={`flex items-start gap-1.5 text-aux ${out.ok ? 'text-ink-2' : 'text-warn'}`}>
      <Icon name={out.ok ? 'check' : 'close'} className={`mt-[3px] size-3 [stroke-width:2] ${out.ok ? 'text-ok' : 'text-warn'}`} />
      <span className="whitespace-pre-wrap">{text}</span>
    </p>
  );
}

// 浏览器代发给小间的交接和通知（技术写法 13.12）：显示成可以展开的小卡片，不当成用户原话
function SystemNote({ message }: { message: AgentUIMessage }) {
  const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
  const title = text.match(/^【([^】]+)】/)?.[1] ?? (message.metadata?.system === 'handoff' ? '交接' : '通知');
  return (
    <details className="self-stretch rounded-lg bg-canvas px-3 py-2 text-aux text-ink-2">
      <summary className="cursor-pointer select-none text-muted hover:text-ink">{title} · 已告诉小间</summary>
      <p className="mt-1.5 whitespace-pre-wrap">{text.replace(/^【[^】]+】/, '')}</p>
    </details>
  );
}

export function MessageView({ message, latest }: { message: AgentUIMessage; latest: boolean }) {
  if (message.role === 'user' && message.metadata?.system) return <SystemNote message={message} />;
  if (message.role === 'user') {
    return (
      <div className="flex max-w-[82%] flex-col items-end gap-1.5 self-end">
        {message.parts.map((part, i) => {
          if (part.type === 'data-photos') {
            return (
              <div key={i} className="flex flex-wrap justify-end gap-1.5">
                {part.data.assetIds.map((id) => (
                  <PhotoThumb key={id} assetId={id} />
                ))}
              </div>
            );
          }
          if (part.type === 'text') {
            return (
              <p key={i} className="whitespace-pre-wrap rounded-[14px] bg-soft px-3 py-[7px] text-body [overflow-wrap:anywhere]">
                {part.text}
              </p>
            );
          }
          return null;
        })}
      </div>
    );
  }

  const label = message.metadata?.modelLabel;
  // 一条回复里每一步都有思考过程，合并成一个放在第一段的位置
  const reasoning = message.parts
    .filter((p) => p.type === 'reasoning')
    .map((p) => (p.type === 'reasoning' ? p.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
  const firstReasoning = message.parts.findIndex((p) => p.type === 'reasoning');
  const thinking = message.parts.some((p) => p.type === 'reasoning' && p.state === 'streaming');
  return (
    <div className="flex flex-col gap-2 text-body [overflow-wrap:anywhere]">
      {message.parts.map((part, i) => {
        if (part.type === 'text') return part.text.trim() ? <RichText key={i} text={part.text} /> : null;
        if (part.type === 'reasoning') {
          // 只展示模型真实的思考输出（AC-11.7）
          // 用 React Bits Thought Line：思考中呼吸动画并展开，想完自动收起，按段落列出
          return i === firstReasoning && reasoning ? (
            <ThoughtLine
              key={i}
              label="小间在思考…"
              doneLabel="思考过程"
              showTimer={false}
              working={thinking}
              steps={reasoning.split(/\n{2,}/)}
              fontSize={12}
              color="var(--color-muted)"
            />
          ) : null;
        }
        if (part.type === 'tool-request_approval') {
          // 被拒绝时（比如用模板时要背景批准）照常显示原因
          if (part.state === 'output-available' && !(part.output as ToolOutput).ok) return <ToolRecord key={i} part={part} />;
          return <ApprovalCard key={i} kind={part.input?.kind ?? 'scene'} active={latest} done={part.state === 'output-available'} />;
        }
        // 卡片类工具：执行器同意（ok）后才显示卡片；被拒绝时照常显示原因
        if (isToolUIPart(part) && part.state === 'output-available' && (part.output as ToolOutput).ok) {
          if (part.type === 'tool-offer_picks') return <PicksCard key={i} input={part.input} active={latest} />;
          if (part.type === 'tool-offer_export') return <ExportCard key={i} round={part.input.round} candidate={part.input.candidate} />;
          if (part.type === 'tool-propose_views') return <ViewsCard key={i} toolCallId={part.toolCallId} input={part.input} active={latest} />;
          if (part.type === 'tool-propose_retry') return <RetryCard key={i} toolCallId={part.toolCallId} input={part.input} active={latest} />;
          if (part.type === 'tool-ask_confirm') return <AskCard key={i} toolCallId={part.toolCallId} active={latest} />;
        }
        return <ToolRecord key={i} part={part} />;
      })}
      {label && <span className="text-label text-faint">由 {label} 回复</span>}
    </div>
  );
}
