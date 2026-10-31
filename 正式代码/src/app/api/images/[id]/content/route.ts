import type { NextRequest } from 'next/server';
import { fetchImageContent, getImageTask } from '@/server/aihubmix';
import { fakeGateway } from '@/server/env';
import { errorResponse } from '@/server/errors';
import { fakeContent } from '@/server/fake-images';

// 取回生成结果的图片二进制，浏览器拿到后立刻存进本地数据库（网关结果只保留 1 小时）
export async function GET(req: NextRequest, ctx: RouteContext<'/api/images/[id]/content'>) {
  try {
    const { id } = await ctx.params;
    const index = Number(req.nextUrl.searchParams.get('i') ?? 0);
    if (!Number.isInteger(index) || index < 0 || index > 9) {
      return Response.json({ error: { code: 'invalid_request', message: '结果序号不对' } }, { status: 400 });
    }
    if (fakeGateway()) return await fakeContent(id);
    const task = await getImageTask(id);
    if (task.status !== 'completed') {
      return Response.json({ error: { code: 'result_not_ready', message: '结果还没准备好' } }, { status: 409 });
    }
    const { bytes, mime } = await fetchImageContent(task, index);
    return new Response(bytes, { headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
