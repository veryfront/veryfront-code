import { resolveImport } from "./resolver.js";
function shouldResolve(specifier, options) {
    if (specifier.startsWith("https://esm.sh/") || specifier.startsWith("http://esm.sh/")) {
        return true;
    }
    const isBare = !specifier.startsWith("http") && !specifier.startsWith("/") &&
        !specifier.startsWith(".");
    if (isBare && !options?.resolveBare) {
        return false;
    }
    return true;
}
export function transformImportsWithMap(code, importMap, scope, options) {
    const resolve = (specifier) => resolveImport(specifier, importMap, scope);
    let transformedCode = code;
    transformedCode = transformedCode.replace(/((?:import|export)\s+(?:[\w,{}\s*]+\s+from\s+)?|export\s+(?:\*|\{[^}]+\})\s+from\s+)["']([^"']+)["']/g, (_match, prefix, specifier) => {
        if (!shouldResolve(specifier, options))
            return `${prefix}"${specifier}"`;
        return `${prefix}"${resolve(specifier)}"`;
    });
    transformedCode = transformedCode.replace(/from\s+["']([^"']+)["']/g, (match, specifier) => {
        if (!shouldResolve(specifier, options))
            return match;
        return `from "${resolve(specifier)}"`;
    });
    transformedCode = transformedCode.replace(/import\s*\(\s*["']([^"']+)["']\s*\)/g, (_match, specifier) => {
        return `import("${resolve(specifier)}")`;
    });
    return transformedCode;
}
