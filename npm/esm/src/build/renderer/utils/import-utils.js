/**
 * Import resolution and extraction utilities
 */
import { existsSync } from "../../../platform/compat/std/fs.js";
import { dirname, join, resolve } from "../../../platform/compat/path/index.js";
/**
 * Extract import statements from code
 */
export function extractImports(code) {
    const imports = [];
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    const dynamicImportRegex = /import\s*\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
        if (match[1])
            imports.push(match[1]);
    }
    while ((match = dynamicImportRegex.exec(code)) !== null) {
        if (match[1])
            imports.push(match[1]);
    }
    return [...new Set(imports)];
}
/**
 * Resolve import path relative to file
 */
export function resolveImportPath(importPath, fromFile, _projectDir) {
    if (importPath.startsWith(".")) {
        return resolve(dirname(fromFile), importPath);
    }
    if (!importPath.startsWith("/") && !importPath.includes(":")) {
        return importPath;
    }
    return importPath;
}
/**
 * Find component file with various extensions
 */
export function findComponent(basePath, _projectDir) {
    const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
    for (const ext of extensions) {
        const fullPath = `${basePath}${ext}`;
        if (existsSync(fullPath))
            return fullPath;
        const indexPath = join(basePath, `index${ext}`);
        if (existsSync(indexPath))
            return indexPath;
    }
    return null;
}
/**
 * Process and update import paths in code
 */
export async function processImports(code, filePath, projectDir, processImport) {
    const imports = extractImports(code);
    let processedCode = code;
    for (const importPath of imports) {
        const resolvedPath = resolveImportPath(importPath, filePath, projectDir);
        const newPath = await processImport(resolvedPath);
        if (!newPath || newPath === importPath)
            continue;
        processedCode = processedCode.replace(new RegExp(`(['"])${importPath}\\1`, "g"), `$1${newPath}$1`);
    }
    return processedCode;
}
