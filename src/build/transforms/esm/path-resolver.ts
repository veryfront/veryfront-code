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
  const depth = fileDir.split("/").filter(Boolean).length;
  const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("@/")) {
      const path = specifier.substring(2);
      const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
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
  if (!moduleServerUrl) {
    return Promise.resolve(code);
  }

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
      const resolvedPath = resolveRelativePath(fileDir, specifier);
      return `${moduleServerUrl}/${resolvedPath}`;
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

export function resolveRelativeImportsToAbsolute(
  code: string,
  filePath: string,
  _projectDir: string,
): Promise<string> {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/"));

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const absolutePath = resolveAbsolutePath(fileDir, specifier);
      return `file://${absolutePath}`;
    }
    return null;
  }));
}

export function resolveRelativeImportsForNodeSSR(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return specifier.replace(/\.(tsx|ts|jsx)$/, ".js");
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
