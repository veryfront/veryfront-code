import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { type AliasOptions, mergeConfig } from "vite";
import {
  createVeryfrontAliases,
  veryfrontRepoRoot,
} from "./veryfront-aliases.ts";

const asyncHooksShim = fileURLToPath(
  new URL("./shims/async-hooks.ts", import.meta.url),
);

function withStorybookBrowserAliases(aliases: AliasOptions): AliasOptions {
  const browserAliases = [
    {
      find: /^#veryfront\/platform\/compat\/async-context\.ts$/,
      replacement: asyncHooksShim,
    },
    { find: /^node:async_hooks$/, replacement: asyncHooksShim },
  ];

  if (Array.isArray(aliases)) return [...browserAliases, ...aliases];
  return { ...aliases, "node:async_hooks": asyncHooksShim };
}

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx|mdx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-links"],
  staticDirs: ["./static"],
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
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
        alias: withStorybookBrowserAliases(createVeryfrontAliases()),
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
