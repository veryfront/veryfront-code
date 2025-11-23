import { defineConfig } from '../../src/core/config/index.ts';

export default defineConfig({
  router: 'app',

  // Import map for resolving veryfront modules within the monorepo
  resolve: {
    importMap: {
      imports: {
        'veryfront/ai': '../../src/ai/index.ts',
        'veryfront/ai/': '../../src/ai/',
      },
    },
  },

  security: {
    cors: true,
  },
});
