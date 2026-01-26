import { replaceSpecifiers } from "./lexer.js";
import { getDenoNpmReactMap, getReactImportMap, REACT_VERSION } from "./package-registry.js";
import { isDeno } from "../../platform/compat/runtime.js";
import { getLocalReactPaths } from "../../platform/compat/react-paths.js";

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

// deno-lint-ignore require-await
export async function resolveReactImports(
  code: string,
  forSSR: boolean = false,
  reactVersion: string = REACT_VERSION,
): Promise<string> {
  const reactImports = getReactImportMap(reactVersion);

  if (!forSSR) {
    return replaceSpecifiers(code, (specifier) => reactImports[specifier] ?? null);
  }

  // For Deno SSR: Use npm: specifiers (auto-deduplicated by Deno's npm cache)
  // For Node/Bun SSR: Use local node_modules paths (auto-deduplicated by Node)
  // See: https://deno.com/blog/not-using-npm-specifiers-doing-it-wrong
  const ssrImports: Record<string, string> = {
    ...getVeryfrontModulePaths(),
    ...(isDeno ? getDenoNpmReactMap(reactVersion) : getLocalReactPaths()),
  };

  return replaceSpecifiers(code, (specifier) => ssrImports[specifier] ?? null);
}

export function addDepsToEsmShUrls(
  code: string,
  _forSSR: boolean = false,
  reactVersion: string = REACT_VERSION,
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
