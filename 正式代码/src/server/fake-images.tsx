import 'server-only';
import { ImageResponse } from 'next/og';
import type { Ratio } from '@/config/ratios';
import { newId } from '@/domain/util';
import type { GatewayImageTask } from './aihubmix';
import { GatewayError } from './errors';

/* 假生图网关：只给开发和自动化测试用（FAKE_GATEWAY=1，且不是生产环境），不调用模型、不花钱、不记账。
   任务存在开发服务器的内存里，几秒后完成；图片上写明是测试图、不是 AI 生成（AC-08.6）。
   提示词里带「【测试：失败一张】」时，同一段提示词第一次提交的那张失败、之后的成功；带「【测试：全部失败】」时每张都失败。 */

const SIZES: Record<Ratio, [number, number]> = { '1:1': [1024, 1024], '3:4': [960, 1280], '9:16': [900, 1600] };
const PENDING_MS = 1500;
const DONE_MS = 4000;

interface FakeTask {
  id: string;
  at: number;
  ratio: Ratio;
  fail: boolean;
}

// 存在 globalThis 上：开发模式热更新或不同接口各自加载模块时，提交和查询看到的是同一份
const store = ((globalThis as { __yijianFakeImages?: { tasks: Map<string, FakeTask>; failedOnce: Set<string> } }).__yijianFakeImages ??= {
  tasks: new Map(),
  failedOnce: new Set(),
});
const { tasks, failedOnce } = store;

const shape = (id: string, status: GatewayImageTask['status']): GatewayImageTask => ({ id, status, output: [], error: null, expires_at: null });

export function submitFake(prompt: string, ratio: Ratio): GatewayImageTask {
  let fail = prompt.includes('【测试：全部失败】');
  if (!fail && prompt.includes('【测试：失败一张】') && !failedOnce.has(prompt)) {
    failedOnce.add(prompt);
    fail = true;
  }
  const id = newId('fake');
  tasks.set(id, { id, at: Date.now(), ratio, fail });
  return shape(id, 'pending');
}

function find(id: string): FakeTask {
  const t = tasks.get(id);
  if (!t) throw new GatewayError(404, 'task_not_found', '假网关里没有这个任务（开发服务器重启过）');
  return t;
}

export function getFake(id: string): GatewayImageTask {
  const t = find(id);
  const age = Date.now() - t.at;
  if (age < PENDING_MS) return shape(id, 'pending');
  if (age < DONE_MS) return shape(id, 'in_progress');
  if (t.fail) return { ...shape(id, 'failed'), error: { code: 'image_not_generated', message: '假网关按测试要求返回失败' } };
  return { ...shape(id, 'completed'), output: [{ index: 0, b64_json: null, content_url: null }] };
}

export async function fakeContent(id: string): Promise<Response> {
  const t = find(id);
  if (getFake(id).status !== 'completed') throw new GatewayError(409, 'result_not_ready', '结果还没准备好');
  const [width, height] = SIZES[t.ratio];
  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          background: 'linear-gradient(150deg, #ecebe8, #d5d3ce 60%, #a8a49d)',
          color: '#4d4d4d',
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: 4 }}>TEST IMAGE</div>
        <div style={{ fontSize: 36 }}>NOT AI GENERATED</div>
        <div style={{ fontSize: 28, color: '#6b6b6b' }}>{`${t.ratio} · ${id.slice(-6)}`}</div>
      </div>
    ),
    { width, height },
  );
  // 先渲染完再返回：渲染出错时接口能如实报错，而不是给浏览器半截响应
  const bytes = await image.arrayBuffer();
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
}
