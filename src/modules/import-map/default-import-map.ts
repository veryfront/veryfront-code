import type { ImportMapConfig } from "./types.ts";

const FRAMEWORK_ROOT = new URL("../../..", import.meta.url).pathname;

function getVeryfrontSsrImportMap(): Record<string, string> {
  const srcPath = `file://${FRAMEWORK_ROOT}src`;
  const head = `${srcPath}/react/components/Head.tsx`;
  const router = `${srcPath}/react/router/index.ts`;
  const context = `${srcPath}/react/context/index.ts`;
  const fonts = `${srcPath}/react/fonts/index.ts`;

  return {
    "veryfront/head": head,
    "veryfront/router": router,
    "veryfront/context": context,
    "veryfront/fonts": fonts,
    "veryfront/react/head": head,
    "veryfront/react/router": router,
    "veryfront/react/context": context,
    "veryfront/react/fonts": fonts,
  };
}

export function getDefaultImportMap(): ImportMapConfig {
  return { imports: getVeryfrontSsrImportMap() };
}
