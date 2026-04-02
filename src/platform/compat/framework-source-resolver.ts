import { join } from "#veryfront/compat/path/index.ts";
import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "./fs.ts";
import { getFrameworkRootFromMeta } from "./vfs-paths.ts";

export const FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);
export const FRAMEWORK_EMBEDDED_SRC_DIR = join(FRAMEWORK_ROOT, "dist", "framework-src");

export const DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS = [
  ".tsx.src",
  ".ts.src",
  ".jsx.src",
  ".js.src",
  ".mdx.src",
  ".md.src",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mdx",
  ".md",
] as const;

export interface FrameworkSourceFileSystem {
  stat(path: string): Promise<FileInfo>;
}

export interface FrameworkSourceLookupResult {
  path: string;
  lookupDir: string;
}

export interface ResolveFrameworkSourcePathOptions {
  fileSystem?: FrameworkSourceFileSystem;
  extraLookupDirs?: string[];
  extensions?: readonly string[];
  includeIndexFallback?: boolean;
}

export function getFrameworkSourceLookupDirs(extraLookupDirs: string[] = []): string[] {
  const seen = new Set<string>();
  const ordered = [
    join(FRAMEWORK_ROOT, "src"),
    FRAMEWORK_EMBEDDED_SRC_DIR,
    ...extraLookupDirs,
  ];

  return ordered.filter((dir) => {
    if (seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

export async function resolveFrameworkSourcePath(
  relativePathWithoutExt: string,
  options: ResolveFrameworkSourcePathOptions = {},
): Promise<FrameworkSourceLookupResult | null> {
  const fs = options.fileSystem ?? createFileSystem();
  const lookupDirs = getFrameworkSourceLookupDirs(options.extraLookupDirs);
  const extensions = options.extensions ?? DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS;
  const candidates = [relativePathWithoutExt];

  if (options.includeIndexFallback !== false) {
    candidates.push(`${relativePathWithoutExt}/index`);
  }

  for (const lookupDir of lookupDirs) {
    for (const candidate of candidates) {
      for (const ext of extensions) {
        const candidatePath = join(lookupDir, candidate + ext);

        try {
          const stat = await fs.stat(candidatePath);
          if (stat.isFile) {
            return {
              path: candidatePath,
              lookupDir,
            };
          }
        } catch {
          /* expected: candidate may not exist */
        }
      }
    }
  }

  return null;
}
