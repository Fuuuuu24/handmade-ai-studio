import { z } from 'zod';
import { BUDGET } from '@/config/budget';
import { imageEstimate, imageModel } from '@/config/models';
import { RATIOS } from '@/config/ratios';
import { imageCostCheck } from '@/domain/cost';
import { submitImage } from '@/server/aihubmix';
import { fakeGateway } from '@/server/env';
import { errorResponse, GatewayError } from '@/server/errors';
import { submitFake } from '@/server/fake-images';
import { attachRef, refund, reserve } from '@/server/ledger';

const Body = z.object({
  model: z.string(),
  prompt: z.string().min(1).max(4000),
  ratio: z.enum(RATIOS),
  images: z.array(z.string().startsWith('data:image/')).max(8),
});

// 提交一个生图任务（每张候选单独一个任务，AC-08.5）。先按估价记账，超预算直接拒绝
export async function POST(req: Request) {
  let ledgerId: string | null = null;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: { code: 'invalid_request', message: '请求参数不对', detail: parsed.error.message } }, { status: 400 });
    }
    const input = parsed.data;
    const model = imageModel(input.model);
    if (!model) return Response.json({ error: { code: 'unknown_model', message: '没有配置这个生图模型' } }, { status: 400 });
    const estUSD = imageEstimate(model, input.images.length);
    const cap = imageCostCheck(estUSD, BUDGET.maxImageUSD);
    if (!cap.ok) return Response.json({ error: { code: 'over_image_cap', message: cap.reason } }, { status: 400 });

    if (fakeGateway()) {
      const fake = submitFake(input.prompt, input.ratio);
      return Response.json({ gatewayId: fake.id, status: fake.status, estUSD: 0, ledgerId: '' });
    }

    const entry = await reserve('image', model.id, estUSD);
    ledgerId = entry.id;
    const task = await submitImage(model, { prompt: input.prompt, ratio: input.ratio, images: input.images });
    await attachRef(entry.id, task.id);
    return Response.json({ gatewayId: task.id, status: task.status, estUSD, ledgerId: entry.id });
  } catch (e) {
    // 请求被网关直接拒绝（4xx）时没有生成，退回预留；5xx 不能确认是否已扣费，保留。
    // 例外：relay 模式下服务器回 not_configured（服务器的 key 没配好或已停用），请求没有发到 AIHubMix，退回
    if (ledgerId && e instanceof GatewayError && (e.status < 500 || e.code === 'not_configured')) await refund(ledgerId);
    return errorResponse(e);
  }
}
