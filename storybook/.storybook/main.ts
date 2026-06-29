import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vite";
import {
  createVeryfrontAliases,
  veryfrontRepoRoot,
} from "./veryfront-aliases.ts";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx|mdx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  viteFinal(baseConfig, { configType }) {
    return mergeConfig(baseConfig, {
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          configType === "PRODUCTION" ? "production" : "development",
        ),
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: createVeryfrontAliases(),
      },
      server: {
        fs: {
          allow: [veryfrontRepoRoot],
        },
      },
    });
  },
};

export default config;
