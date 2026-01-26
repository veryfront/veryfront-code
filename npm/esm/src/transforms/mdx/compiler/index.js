export { compileMDXRuntime } from "./mdx-compiler.js";
export { extractFrontmatter } from "./frontmatter-extractor.js";
export { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.js";
import { compileMDXRuntime } from "./mdx-compiler.js";
import { compileMarkdownRuntime } from "../../md/compiler/index.js";
function isMarkdownFile(filePath) {
    if (!filePath)
        return false;
    return filePath.endsWith(".md");
}
export function compileContent(mode, projectDir, content, frontmatter, filePath, target = "server", baseUrl) {
    if (isMarkdownFile(filePath)) {
        return compileMarkdownRuntime(mode, projectDir, content, frontmatter, filePath, target, baseUrl);
    }
    return compileMDXRuntime(mode, projectDir, content, frontmatter, filePath, target, baseUrl);
}
