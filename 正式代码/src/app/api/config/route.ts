import { CHAT_MODELS, DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@/config/models';
import { credentialStatus } from '@/server/credentials';
import { fakeChat, fakeGateway } from '@/server/env';
import { errorResponse } from '@/server/errors';
import { budgetSummary } from '@/server/ledger';

// 可选模型与预算余量（不含密钥）。读账本文件，每次请求都实时计算
export async function GET() {
  try {
    // 凭据来源和是否可用（技术写法第 12.4 节）：不含尾号和密钥；管理后台用 revision 核对主产品读的是不是同一份凭据文件
    const credential = await credentialStatus();
    return Response.json({
      configured: credential.ready,
      credential,
      fake: fakeGateway(),
      fakeChat: fakeChat(), // 假对话模型：小间的回复是剧本，界面要标明 // 假生图网关：界面要标明结果是测试图（AC-08.6）
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
