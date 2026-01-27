import { replaceSpecifiers } from "./lexer.js";
import { getReactImportMap, REACT_VERSION } from "./package-registry.js";

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

  // For SSR: Use esm.sh URLs consistently (NO npm: specifiers per plan requirements)
  const ssrImports: Record<string, string> = {
    ...getVeryfrontModulePaths(),
    ...reactImports,
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
