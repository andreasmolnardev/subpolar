import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'test/services/general-chat.test.ts',
      'test/services/internal-token.test.ts',
      'test/auth/internal-token-middleware.test.ts',
      'test/routes/internal-automations.test.ts',
      'test/routes/internal-notifications.test.ts',
      'test/routes/internal-settings.test.ts',
      'test/routes/internal-repos.test.ts',
      'src/db/model-state.test.ts',
      'src/routes/providers.test.ts',
      'src/routes/repos.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      WORKSPACE_PATH: '/tmp/test-workspace',
    },
  },
})
