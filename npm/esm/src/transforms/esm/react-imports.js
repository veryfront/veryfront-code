import { replaceSpecifiers } from "./lexer.js";
import { getReactImportMap, REACT_VERSION } from "./package-registry.js";
import { getLocalReactPaths } from "../../platform/compat/react-paths.js";
import { isDeno, isNode } from "../../platform/compat/runtime.js";
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
    // For SSR: Handle React imports differently per runtime.
    // - Node.js: Use esm.sh URLs, which will be cached to disk by cacheHttpImportsToLocal.
    //   The cached bundles are ESM-compatible and can be imported via file:// URLs.
    //   Bare specifiers don't work because React isn't in the cache directory's node_modules.
    // - Deno: Use esm.sh URLs (Deno supports HTTP imports natively).
    // - Bun: Use local file:// paths (Bun handles CJS/ESM interop with file:// URLs).
    const localReactPaths = getLocalReactPaths();
    const ssrReactImports = isDeno || isNode
        ? reactImports // esm.sh URLs for Deno and Node.js (Node.js will cache them)
        : { ...reactImports, ...localReactPaths }; // file:// paths for Bun
    const ssrImports = {
        ...getVeryfrontModulePaths(),
        ...ssrReactImports,
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
