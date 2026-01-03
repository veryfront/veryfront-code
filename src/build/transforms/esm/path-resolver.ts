import { replaceSpecifiers } from "./lexer.ts";

/**
 * Rewrite @veryfront/* imports to veryfront/* for npm compatibility
 * This allows Deno-style imports to work in Node.js environments
 */
export function resolveVeryfrontImports(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("@veryfront/")) {
      // @veryfront/ai -> veryfront/ai
      // @veryfront/ai/react -> veryfront/ai/react
      return specifier.replace("@veryfront/", "veryfront/");
    }
    if (specifier === "@veryfront") {
      return "veryfront";
    }
    return null;
  }));
}

export function resolvePathAliases(
  code: string,
  filePath: string,
  projectDir: string,
  ssr = false,
): Promise<string> {
  const _normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

  // For both SSR and browser, we need to resolve @/ aliases to relative paths
  // SSR files are written to a temp directory with the same relative structure as the source
  // So @/components from pages/index.tsx becomes ../components (relative path)
  let relativeFilePath = filePath;
  if (filePath.startsWith(_normalizedProjectDir)) {
    relativeFilePath = filePath.substring(_normalizedProjectDir.length + 1);
  } else if (filePath.startsWith("/")) {
    const pathParts = filePath.split("/");
    const projectParts = _normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];
    const projectIndex = pathParts.indexOf(lastProjectPart!);
    if (projectIndex >= 0) {
      relativeFilePath = pathParts.slice(projectIndex + 1).join("/");
    }
  }

  const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
  const depth = fileDir.split("/").filter(Boolean).length;
  const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("@/")) {
      const path = specifier.substring(2);
      // @/ maps to project root in veryfront projects
      const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
      // Add .js extension if path doesn't already have a valid JS/TS extension
      // This ensures Deno can properly identify the module type when loading via HTTP
      if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
        return relativePath + ".js";
      }
      // For SSR, also normalize TS/TSX extensions to .js
      if (ssr) {
        return relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
      }
      return relativePath;
    }
    return null;
  }));
}

export function resolveRelativeImports(
  code: string,
  filePath: string,
  projectDir: string,
  moduleServerUrl?: string,
): Promise<string> {
  const _normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

  let relativeFilePath = filePath;
  if (filePath.startsWith(_normalizedProjectDir)) {
    relativeFilePath = filePath.substring(_normalizedProjectDir.length + 1);
  } else if (filePath.startsWith("/")) {
    const pathParts = filePath.split("/");
    const projectParts = _normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];
    const projectIndex = pathParts.indexOf(lastProjectPart!);
    if (projectIndex >= 0) {
      relativeFilePath = pathParts.slice(projectIndex + 1).join("/");
    }
  }

  const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      // Rewrite TypeScript extensions to .js for browser compatibility
      let rewrittenSpecifier = specifier;
      if (/\.(tsx?|jsx)$/.test(specifier)) {
        rewrittenSpecifier = specifier.replace(/\.(tsx?|jsx)$/, ".js");
      }

      // If moduleServerUrl provided, convert to absolute URL
      if (moduleServerUrl) {
        const resolvedPath = resolveRelativePath(fileDir, rewrittenSpecifier);
        return `${moduleServerUrl}/${resolvedPath}`;
      }

      return rewrittenSpecifier;
    }
    return null;
  }));
}

function resolveRelativePath(currentDir: string, importPath: string): string {
  const currentParts = currentDir.split("/").filter(Boolean);
  const importParts = importPath.split("/").filter(Boolean);

  const resolvedParts = [...currentParts];
  for (const part of importParts) {
    if (part === "..") {
      resolvedParts.pop(); // Go up one directory
    } else if (part !== ".") {
      resolvedParts.push(part); // Add to path
    }
  }

  return resolvedParts.join("/");
}

export async function resolveRelativeImportsToAbsolute(
  code: string,
  filePath: string,
  _projectDir: string,
): Promise<string> {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/"));

  // Build a map of specifiers to resolved paths with extensions
  const resolvedImports = new Map<string, string>();
  const specifiersToResolve: string[] = [];

  // First pass: collect all relative import specifiers
  await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      specifiersToResolve.push(specifier);
    }
    return null;
  });

  // Resolve each specifier to an absolute path with extension
  for (const specifier of specifiersToResolve) {
    const absolutePath = resolveAbsolutePath(fileDir, specifier);
    const resolvedPath = await findFileWithExtension(absolutePath);
    resolvedImports.set(specifier, `file://${resolvedPath}`);
  }

  // Second pass: replace specifiers with resolved paths
  return replaceSpecifiers(code, (specifier) => {
    return resolvedImports.get(specifier) || null;
  });
}

/**
 * Find a file by trying common TypeScript/JavaScript extensions
 * If the path already has an extension, return it as-is
 */
async function findFileWithExtension(basePath: string): Promise<string> {
  // If already has a valid extension, return as-is
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(basePath)) {
    return basePath;
  }

  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    try {
      const stat = await Deno.stat(fullPath);
      if (stat.isFile) {
        return fullPath;
      }
    } catch {
      // File doesn't exist with this extension, try next
    }
  }

  // If no file found, return with .ts extension as fallback
  // (Deno will give a clearer error message)
  return basePath + ".ts";
}

export function resolveRelativeImportsForNodeSSR(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return specifier.replace(/\.(tsx|ts|jsx)$/, ".js");
    }
    return null;
  }));
}

export function resolveRelativeImportsForSSR(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (/\.(js|mjs|cjs)$/.test(specifier)) {
        return null;
      }
      const withoutExt = specifier.replace(/\.(tsx?|jsx|mdx)$/, "");
      return withoutExt + ".js";
    }
    return null;
  }));
}

function resolveAbsolutePath(baseDir: string, relativePath: string): string {
  const baseParts = baseDir.split("/").filter(Boolean);
  const relativeParts = relativePath.split("/").filter(Boolean);

  const resolvedParts = [...baseParts];
  for (const part of relativeParts) {
    if (part === "..") {
      resolvedParts.pop();
    } else if (part !== ".") {
      resolvedParts.push(part);
    }
  }

  return "/" + resolvedParts.join("/");
}
