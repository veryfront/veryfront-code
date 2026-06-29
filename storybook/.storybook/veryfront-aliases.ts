import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AliasOptions } from "vite";

const storybookConfigDir = path.dirname(fileURLToPath(import.meta.url));
const storybookRoot = path.resolve(storybookConfigDir, "..");
export const veryfrontRepoRoot = path.resolve(storybookRoot, "..");

function sourcePath(...segments: string[]): string {
  return path.resolve(veryfrontRepoRoot, ...segments);
}

export function createVeryfrontAliases(): AliasOptions {
  return [
    { find: /^veryfront\/chat$/, replacement: sourcePath("src/chat/index.ts") },
    {
      find: /^veryfront\/react\/components\/chat$/,
      replacement: sourcePath("src/react/components/chat/index.ts"),
    },
    {
      find: /^veryfront\/components\/chat$/,
      replacement: sourcePath("src/react/components/chat/index.ts"),
    },
    {
      find: /^veryfront\/head$/,
      replacement: sourcePath("src/react/components/Head.tsx"),
    },
    { find: /^veryfront\/mdx$/, replacement: sourcePath("src/mdx/index.ts") },
    {
      find: /^veryfront\/markdown$/,
      replacement: sourcePath("src/markdown/index.ts"),
    },
    {
      find: /^veryfront\/router$/,
      replacement: sourcePath("src/react/router/index.tsx"),
    },
    {
      find: /^veryfront\/context$/,
      replacement: sourcePath("src/react/context/index.tsx"),
    },
    {
      find: /^veryfront\/fonts$/,
      replacement: sourcePath("src/react/fonts/index.ts"),
    },
    {
      find: /^#veryfront\/agent\/react$/,
      replacement: sourcePath("src/agent/react/index.ts"),
    },
    {
      find: /^#veryfront\/agent$/,
      replacement: sourcePath("src/agent/index.ts"),
    },
    {
      find: /^#veryfront\/react$/,
      replacement: sourcePath("src/react/index.ts"),
    },
    {
      find: /^#veryfront\/types$/,
      replacement: sourcePath("src/types/index.ts"),
    },
    {
      find: /^#veryfront\/utils$/,
      replacement: sourcePath("storybook/.storybook/shims/veryfront-utils.ts"),
    },
    {
      find: /^#veryfront\/utils\/path-utils\.ts$/,
      replacement: sourcePath("storybook/.storybook/shims/path-utils.ts"),
    },
    { find: /^#veryfront\/(.+)$/, replacement: sourcePath("src/$1") },
    { find: /^#veryfront$/, replacement: sourcePath("src/index.ts") },
  ];
}
