import { CHAT_MODELS, DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@/config/models';
import { fakeGateway } from '@/server/env';
import { errorResponse } from '@/server/errors';
import { budgetSummary } from '@/server/ledger';

// 可选模型与预算余量（不含密钥）。读账本文件，每次请求都实时计算
export async function GET() {
  try {
    return Response.json({
      configured: Boolean(process.env.AIHUBMIX_API_KEY?.trim()),
      fake: fakeGateway(), // 假生图网关：界面要标明结果是测试图（AC-08.6）
      operator: process.env.TRIAL_OPERATOR === '1', // 试用操作员：资产页显示 A/B 路线开关（PRD 4.3，不给商家看）
      chatModels: CHAT_MODELS.map(({ id, label, vision }) => ({ id, label, vision })),
      imageModels: IMAGE_MODELS.map(({ id, label, perImageUSD }) => ({ id, label, perImageUSD })),
      defaults: { chatModel: DEFAULT_CHAT_MODEL, imageModel: DEFAULT_IMAGE_MODEL },
      budget: await budgetSummary(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
