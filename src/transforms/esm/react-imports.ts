import { replaceSpecifiers } from "./lexer.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./package-registry.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";

const srcDir = new URL(".", import.meta.url).pathname.replace(
  /\/(build|src)\/transforms\/esm\/?$/,
  "",
);

function getVeryfrontModulePaths(): Record<string, string> {
  return {
    "veryfront/agent/react": `file://${srcDir}/agent/react/index.ts`,
    "veryfront/components/ai": `file://${srcDir}/react/components/ai/index.ts`,
    "veryfront/primitives": `file://${srcDir}/react/primitives/index.ts`,
  };
}

export async function resolveReactImports(
  code: string,
  forSSR: boolean = false,
  reactVersion: string = DEFAULT_REACT_VERSION,
): Promise<string> {
  const reactImports = getReactImportMap(reactVersion);

  if (!forSSR) {
    return replaceSpecifiers(code, (specifier) => reactImports[specifier] ?? null);
  }

  const ssrReactImports = isDeno || isNode
    ? reactImports
    : { ...reactImports, ...getLocalReactPaths() };

  const ssrImports: Record<string, string> = {
    ...getVeryfrontModulePaths(),
    ...ssrReactImports,
  };

  return replaceSpecifiers(code, (specifier) => ssrImports[specifier] ?? null);
}

export function addDepsToEsmShUrls(
  code: string,
  _forSSR: boolean = false,
  reactVersion: string = DEFAULT_REACT_VERSION,
): Promise<string> {
  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      if (!specifier.startsWith("https://esm.sh/")) return null;
      if (specifier.includes(`react@${reactVersion}`)) return null;
      if (specifier.includes("?")) return null;
      return `${specifier}?external=react,react-dom&target=es2022`;
    }),
  );
}
