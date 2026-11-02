import type { NextRequest } from 'next/server';
import { relayGet, relayPost } from '@/server/relay';

// 协作者转发（技术写法第 12.5 节），逻辑在 server/relay.ts
export async function GET(req: NextRequest, ctx: RouteContext<'/api/relay/aihubmix/[...path]'>) {
  return relayGet(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/relay/aihubmix/[...path]'>) {
  return relayPost(req, (await ctx.params).path);
}
