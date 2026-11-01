'use client';

import { isToolUIPart, getToolName } from 'ai';
import type { AgentUIMessage, ToolOutput } from '@/agent/tools';
import { useBlobUrl } from '@/client/hooks';
import { useWorkspace } from '@/components/workspace/context';
import { Icon } from '@/components/ui/icon';
import { ApprovalCard } from './approval-card';
import { RichText } from './rich-text';
import { ExportCard, PicksCard, SceneProposalCard, ShopProposalCard } from './tool-cards';

const TOOL_DOING: Record<string, string> = {
  update_info: '整理商品信息',
  record_story: '记下你说的',
  draft_summary: '起草共创总结',
  set_style: '调整风格',
  apply_scene: '套用布景',
  set_ratio: '设置比例',
  draft_prompt: '写提示词',
  resolve_prompt_sync: '核对手改的提示词',
  request_approval: '准备批准卡片',
  start_generation: '提交生成',
  offer_picks: '准备几个方向',
  make_white_asset: '做白底图',
  set_image_model: '换生图模型',
  retry_candidate: '补齐候选',
  note_feedback: '记下你的意见',
  offer_export: '准备下载',
  propose_scene_save: '准备存布景',
  propose_shop_style: '准备更新我的风格',
  note_followup: '记下后续需求',
  show_step: '切换画布',
};

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
    return <p className="text-aux text-bad">小间{TOOL_DOING[name] ?? name}时出错：{part.errorText}</p>;
  }
  if (part.state !== 'output-available') {
    return (
      <p className="flex items-center gap-1.5 text-aux text-muted">
        <span className="spinner !size-3" aria-hidden="true" />
        正在{TOOL_DOING[name] ?? name}…
      </p>
    );
  }
  const out = part.output as ToolOutput;
  return (
    <p className={`flex items-start gap-1.5 text-aux ${out.ok ? 'text-ink-2' : 'text-warn'}`}>
      <Icon name={out.ok ? 'check' : 'close'} className={`mt-[3px] size-3 [stroke-width:2] ${out.ok ? 'text-ok' : 'text-warn'}`} />
      <span>{out.message}</span>
    </p>
  );
}

export function MessageView({ message, latest }: { message: AgentUIMessage; latest: boolean }) {
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
  return (
    <div className="flex flex-col gap-2 text-body [overflow-wrap:anywhere]">
      {message.parts.map((part, i) => {
        if (part.type === 'text') return part.text.trim() ? <RichText key={i} text={part.text} /> : null;
        if (part.type === 'reasoning') {
          // 只展示模型真实的思考输出（AC-11.7）
          return i === firstReasoning && reasoning ? (
            <details key={i} className="text-aux text-muted">
              <summary className="cursor-pointer select-none hover:text-ink">思考过程</summary>
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-2.5">{reasoning}</p>
            </details>
          ) : null;
        }
        if (isToolUIPart(part) && getToolName(part) === 'request_approval') {
          return <ApprovalCard key={i} active={latest} done={part.state === 'output-available'} />;
        }
        // 卡片类工具：执行器同意（ok）后才显示卡片；被拒绝时照常显示原因
        if (isToolUIPart(part) && part.state === 'output-available' && (part.output as ToolOutput).ok) {
          if (part.type === 'tool-offer_picks') return <PicksCard key={i} input={part.input} active={latest} />;
          if (part.type === 'tool-offer_export') return <ExportCard key={i} round={part.input.round} candidate={part.input.candidate} />;
          if (part.type === 'tool-propose_scene_save') return <SceneProposalCard key={i} toolCallId={part.toolCallId} input={part.input} active={latest} />;
          if (part.type === 'tool-propose_shop_style') return <ShopProposalCard key={i} toolCallId={part.toolCallId} input={part.input} active={latest} />;
        }
        return <ToolRecord key={i} part={part} />;
      })}
      {label && <span className="text-label text-faint">由 {label} 回复</span>}
    </div>
  );
}
