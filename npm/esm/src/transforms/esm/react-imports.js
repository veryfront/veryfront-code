import { replaceSpecifiers } from "./lexer.js";
import { getReactImportMap, REACT_VERSION } from "./package-registry.js";
const srcDir = new URL(".", globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url).pathname.replace(/\/(build|src)\/transforms\/esm\/?$/, "");
function getVeryfrontModulePaths() {
    return {
        "veryfront/agent/react": `file://${srcDir}/agent/react/index.ts`,
        "veryfront/components/ai": `file://${srcDir}/react/components/ai/index.ts`,
        "veryfront/primitives": `file://${srcDir}/react/primitives/index.ts`,
    };
}
// deno-lint-ignore require-await
export async function resolveReactImports(code, forSSR = false, reactVersion = REACT_VERSION) {
    const reactImports = getReactImportMap(reactVersion);
    if (!forSSR) {
        return replaceSpecifiers(code, (specifier) => reactImports[specifier] ?? null);
    }
    // For SSR: Use esm.sh URLs consistently (NO npm: specifiers per plan requirements)
    const ssrImports = {
        ...getVeryfrontModulePaths(),
        ...reactImports,
    };
    return replaceSpecifiers(code, (specifier) => ssrImports[specifier] ?? null);
}
export function addDepsToEsmShUrls(code, _forSSR = false, reactVersion = REACT_VERSION) {
    return Promise.resolve(replaceSpecifiers(code, (specifier) => {
        if (!specifier.startsWith("https://esm.sh/"))
            return null;
        if (specifier.includes(`react@${reactVersion}`))
            return null;
        if (specifier.includes("?"))
            return null;
        return `${specifier}?external=react,react-dom&target=es2022`;
    }));
}
