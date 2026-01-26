import { compile as compileMdx } from "@mdx-js/mdx";
import { getRehypePlugins, getRemarkPlugins } from "../../../transforms/plugins/plugin-loader.js";
export async function compileMDX(content, options) {
    const remarkPlugins = (await getRemarkPlugins());
    const rehypePlugins = (await getRehypePlugins());
    const compiled = await compileMdx(content, {
        outputFormat: "program",
        jsx: true,
        jsxRuntime: "automatic",
        jsxImportSource: "react",
        development: options.mode === "development",
        remarkPlugins,
        rehypePlugins,
    });
    const code = String(compiled.value);
    const imports = extractImports(code);
    return { code, imports };
}
function extractImports(code) {
    const imports = [];
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of code.matchAll(importRegex)) {
        const specifier = match[1];
        if (specifier)
            imports.push(specifier);
    }
    return imports;
}
