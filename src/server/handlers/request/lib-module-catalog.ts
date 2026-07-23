import { joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";

export const LIB_MODULE_PATHS = {
  "chat.js": "esm/src/chat/index.js",
  "markdown.js": "esm/src/markdown/index.js",
  "mdx.js": "esm/src/mdx/index.js",
  "workflow.js": "esm/src/workflow/react/index.js",
} as const;

export type LibModuleName = keyof typeof LIB_MODULE_PATHS;

export function isLibModuleName(value: string): value is LibModuleName {
  return Object.hasOwn(LIB_MODULE_PATHS, value);
}

export function resolveLibModulePath(module: LibModuleName, projectDir: string): string {
  const packageDir = joinPath(joinPath(projectDir, "node_modules"), "veryfront");
  return normalizePath(joinPath(packageDir, LIB_MODULE_PATHS[module]));
}
