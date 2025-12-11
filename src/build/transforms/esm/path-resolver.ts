import { replaceSpecifiers } from "./lexer.ts";

export function resolveVeryfrontImports(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("@veryfront/")) {
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
      resolvedParts.pop();
    } else if (part !== ".") {
      resolvedParts.push(part);
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

  const resolvedImports = new Map<string, string>();
  const specifiersToResolve: string[] = [];

  await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      specifiersToResolve.push(specifier);
    }
    return null;
  });

  for (const specifier of specifiersToResolve) {
    const absolutePath = resolveAbsolutePath(fileDir, specifier);
    const resolvedPath = await findFileWithExtension(absolutePath);
    resolvedImports.set(specifier, `file://${resolvedPath}`);
  }

  return replaceSpecifiers(code, (specifier) => {
    return resolvedImports.get(specifier) || null;
  });
}

async function findFileWithExtension(basePath: string): Promise<string> {
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
    }
  }

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
