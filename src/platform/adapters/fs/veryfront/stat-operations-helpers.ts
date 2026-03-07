import type { ProjectFile } from "../../veryfront-api-client/index.ts";

interface NormalizedIndexedPath {
  normalizedPath: string;
  originalPath?: string;
}

export function normalizeIndexedFilePath(file: ProjectFile): NormalizedIndexedPath {
  if (!file.path.endsWith("/")) {
    return { normalizedPath: file.path };
  }

  const ext = file.type === "page" ? ".mdx" : ".tsx";
  return {
    normalizedPath: file.path.replace(/\/+$/, "") + "/index" + ext,
    originalPath: file.path,
  };
}

export function collectParentDirectories(path: string): string[] {
  const parts = path.split("/");
  const dirs: string[] = [];
  let current = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    dirs.push(current);
  }

  return dirs;
}

export function stripKnownExtension(path: string, extensionPriority: readonly string[]): string {
  const hasExtension = extensionPriority.some((ext) => path.endsWith(ext));
  if (!hasExtension) return path;
  return path.replace(/\.(mdx|md|tsx|jsx|ts|js)$/, "");
}

export function resolveByExtensionPriority(
  fileIdx: Map<string, ProjectFile>,
  candidateBase: string,
  extensionPriority: readonly string[],
): string | null {
  for (const ext of extensionPriority) {
    const candidate = candidateBase + ext;
    if (fileIdx.has(candidate)) return candidate;
  }
  return null;
}

export function resolveIndexByExtensionPriority(
  fileIdx: Map<string, ProjectFile>,
  candidateBase: string,
  extensionPriority: readonly string[],
): string | null {
  for (const ext of extensionPriority) {
    const indexPath = `${candidateBase}/index${ext}`;
    if (fileIdx.has(indexPath)) return indexPath;
  }
  return null;
}

export function sortPathsByExtensionPriority<T extends { path: string }>(
  entries: T[],
  extensionPriority: readonly string[],
): T[] {
  return [...entries].sort((a, b) => {
    const extA = extensionPriority.findIndex((ext) => a.path.endsWith(ext));
    const extB = extensionPriority.findIndex((ext) => b.path.endsWith(ext));
    return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
  });
}
