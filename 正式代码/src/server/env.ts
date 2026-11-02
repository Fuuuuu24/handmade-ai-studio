import 'server-only';
import path from 'node:path';

// 模型密钥按凭据来源读取，见 server/credentials.ts（技术写法第 12 节）；只在服务端读，不发给浏览器

export const ledgerPath = () => process.env.LEDGER_PATH || path.join(process.cwd(), 'data', 'ledger.json');

// 假网关：只给开发和自动化测试用，生产环境即使设了也不生效（server/fake-images.tsx）
export const fakeGateway = () => process.env.FAKE_GATEWAY === '1' && process.env.NODE_ENV !== 'production';

// 假对话模型：只给开发和自动化测试用，生产环境即使设了也不生效（server/fake-chat.ts）
export const fakeChat = () => process.env.FAKE_CHAT === '1' && process.env.NODE_ENV !== 'production';
