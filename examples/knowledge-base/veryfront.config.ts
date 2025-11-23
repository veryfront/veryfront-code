import { defineConfig } from "veryfront";

export default defineConfig({
  router: "app",
  resolve: {
    importMap: {
      imports: {
        "veryfront/ai": "../../src/ai/index.ts",
        "veryfront/ai/": "../../src/ai/",
      },
    },
  },
});
