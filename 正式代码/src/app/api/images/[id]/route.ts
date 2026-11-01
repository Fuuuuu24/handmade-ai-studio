import type { NextRequest } from 'next/server';
import { getImageTask } from '@/server/aihubmix';
import { fakeGateway } from '@/server/env';
import { describeError, errorResponse, GatewayError } from '@/server/errors';
import { getFake } from '@/server/fake-images';
import { refund } from '@/server/ledger';

// 不收费的失败：内容被拦截时网关明确说明不收费（AIHubMix 文档「任务执行失败」）
const NOT_CHARGED = new Set(['output_blocked']);

// 查询生图任务的真实状态（AC-08.4：没有进度信息就不给百分比）
export async function GET(req: NextRequest, ctx: RouteContext<'/api/images/[id]'>) {
  try {
    const { id } = await ctx.params;
    const task = fakeGateway() ? getFake(id) : await getImageTask(id);
    if (task.status === 'failed' || task.status === 'cancelled') {
      const code = task.error?.code ?? task.status;
      const ledgerId = req.nextUrl.searchParams.get('ledger');
      if (ledgerId && NOT_CHARGED.has(code)) await refund(ledgerId, id);
      const { error } = describeError(new GatewayError(200, code, task.error?.message ?? ''));
      return Response.json({ status: task.status, error, outputs: 0 });
    }
    return Response.json({ status: task.status, outputs: task.output.length, expiresAt: task.expires_at });
  } catch (e) {
    return errorResponse(e);
  }
}
