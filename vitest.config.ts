import { defineConfig } from 'vitest/config';

// One test run for the whole repository: the engine (plain Node) and the editor (component tests opt into jsdom
// with a `// @vitest-environment jsdom` line at the top of the file).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
