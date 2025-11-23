export function resolvePathAliases(
  code: string,
  filePath: string,
  projectDir: string,
): string {
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

  const aliasRegex = /from\s+['"]@\/([^'"]+)['"]/g;
  code = code.replace(aliasRegex, (_match, path) => {
    const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
    return `from '${relativePath}'`;
  });

  const dynamicAliasRegex = /import\(['"]@\/([^'"]+)['"]\)/g;
  code = code.replace(dynamicAliasRegex, (_match, path) => {
    const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
    return `import('${relativePath}')`;
  });

  return code;
}

export function resolveRelativeImports(
  code: string,
  filePath: string,
  projectDir: string,
  moduleServerUrl?: string,
): string {
  if (!moduleServerUrl) {
    return code;
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

  const relativeImportRegex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  code = code.replace(relativeImportRegex, (_match, importPath) => {
    const resolvedPath = resolveRelativePath(fileDir, importPath);
    return `from '${moduleServerUrl}/${resolvedPath}'`;
  });

  const dynamicRelativeImportRegex = /import\(['"](\.\.?\/[^'"]+)['"]\)/g;
  code = code.replace(dynamicRelativeImportRegex, (_match, importPath) => {
    const resolvedPath = resolveRelativePath(fileDir, importPath);
    return `import('${moduleServerUrl}/${resolvedPath}')`;
  });

  return code;
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
  projectDir: string,
): string {
  const _normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  // Get the directory of the current file
  const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/"));

  // Convert relative imports to absolute file:// URLs
  const relativeImportRegex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  code = code.replace(relativeImportRegex, (_match, importPath) => {
    // Resolve the relative path to an absolute path
    const absolutePath = resolveAbsolutePath(fileDir, importPath);
    return `from 'file://${absolutePath}'`;
  });

  const dynamicRelativeImportRegex = /import\(['"](\.\.?\/[^'"]+)['"]\)/g;
  code = code.replace(dynamicRelativeImportRegex, (_match, importPath) => {
    const absolutePath = resolveAbsolutePath(fileDir, importPath);
    return `import('file://${absolutePath}')`;
  });

  return code;
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
