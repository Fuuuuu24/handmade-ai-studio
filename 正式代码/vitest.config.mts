import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // server-only 在测试环境里没有 react-server 条件，换成空模块
    alias: { 'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
