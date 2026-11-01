import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 全流程测试（技术写法第 9 节）：假对话模型＋假生图网关，不调用模型、不花钱；用本机的 Chrome，不另下浏览器
const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: path.join(tmpdir(), 'yijian-playwright'),
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FAKE_GATEWAY: '1',
      FAKE_CHAT: '1',
      TRIAL_OPERATOR: '1',
      LEDGER_PATH: path.join(tmpdir(), 'yijian-e2e-ledger.json'),
    },
  },
});
