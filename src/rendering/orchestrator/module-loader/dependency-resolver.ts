import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { parallelMap, rendererLogger } from "#veryfront/utils";
import {
  findStaticImportFromSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";
import { findSourceFile } from "../file-resolver/index.ts";

const logger = rendererLogger.component("module-loader");

type AliasImport = { full: string; path: string; start: number; end: number };
type RelativeImport = { full: string; path: string; fromDir: string; start: number; end: number };

/** Resolved local module dependency discovered in a source module. */
export type ResolvedModuleDependency = {
  full: string;
  path: string;
  start: number;
  end: number;
  relativePath: string;
  depFilePath: string | null;
  isLocalLib: boolean;
};

/** Resolved dependency after its source module has been transformed to a temp file. */
export type TransformedModuleDependency = ResolvedModuleDependency & {
  depTempPath: string;
};

/** Input for resolving local module dependencies from source code. */
export interface ResolveModuleDependenciesInput {
  fileContent: string;
  filePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
}

function collectAliasImports(fileContent: string): AliasImport[] {
  return findStaticImportFromSpans(
    fileContent,
    (specifier) => specifier.startsWith("@/") ? specifier : null,
  ).map(({ original, path, start, end }) => ({
    full: original,
    path,
    start,
    end,
  }));
}

function collectRelativeImports(fileContent: string, fileDir: string): RelativeImport[] {
  return findStaticImportFromSpans(
    fileContent,
    (specifier) => specifier.match(/^(\.\.?\/[^?]+)(?:\?.*)?$/)?.[1],
  )
    .map(({ original, path, start, end }) => ({
      full: original,
      path,
      fromDir: fileDir,
      start,
      end,
    }))
    // Ignore already-transformed file:// imports.
    .filter((imp) => !imp.path.includes("file://"));
}

async function resolveAliasImport(
  imp: AliasImport,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ResolvedModuleDependency> {
  const relativePath = imp.path.substring(2); // Remove @/ prefix.
  const depFilePath = await findSourceFile(relativePath, projectDir, adapter);

  return { ...imp, relativePath, depFilePath, isLocalLib: false };
}

async function resolveRelativeImport(
  imp: RelativeImport,
  projectDir: string,
  canonicalProjectDir: string | undefined,
  adapter: RuntimeAdapter,
): Promise<ResolvedModuleDependency> {
  const basePath = normalize(join(imp.fromDir, imp.path));
  if (!isPathWithinRoot(basePath, projectDir)) {
    throw new TypeError("Relative module import must stay inside the project");
  }

  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  let depFilePath: string | null = null;

  const baseStat = await getSafePathInfo(basePath, canonicalProjectDir, adapter);
  if (baseStat) {
    if (baseStat.isFile) {
      depFilePath = basePath;
    }
  }

  if (!depFilePath) {
    for (const ext of extensions) {
      const pathWithExt = basePath + ext;
      if ((await getSafePathInfo(pathWithExt, canonicalProjectDir, adapter))?.isFile) {
        depFilePath = pathWithExt;
        break;
      }
    }
  }

  if (!depFilePath) {
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if ((await getSafePathInfo(indexPath, canonicalProjectDir, adapter))?.isFile) {
        depFilePath = indexPath;
        break;
      }
    }
  }

  return {
    full: imp.full,
    path: imp.path,
    start: imp.start,
    end: imp.end,
    relativePath: imp.path,
    depFilePath,
    isLocalLib: false,
  };
}

/** Resolves @/ alias and relative local imports from a source module. */
export async function resolveModuleDependencies(
  input: ResolveModuleDependenciesInput,
): Promise<ResolvedModuleDependency[]> {
  if (!isPathWithinRoot(input.filePath, input.projectDir)) {
    throw new TypeError("Module source path must stay inside the project");
  }

  const fileDir = dirname(input.filePath);
  const aliasImports = collectAliasImports(input.fileContent);
  const relativeImports = collectRelativeImports(input.fileContent, fileDir);
  const canonicalProjectDir = input.adapter.fs.realPath && relativeImports.length > 0
    ? await input.adapter.fs.realPath(input.projectDir)
    : undefined;

  logger.debug("Resolving local module dependencies", {
    aliasImportsCount: aliasImports.length,
    relativeImportsCount: relativeImports.length,
  });

  const resolvedAliasDeps = await parallelMap(
    aliasImports,
    (imp) => resolveAliasImport(imp, input.projectDir, input.adapter),
  );
  const resolvedRelativeDeps = await parallelMap(
    relativeImports,
    (imp) => resolveRelativeImport(imp, input.projectDir, canonicalProjectDir, input.adapter),
  );

  return [...resolvedAliasDeps, ...resolvedRelativeDeps];
}

/** Rewrites resolved local imports to their transformed temp file URLs. */
export function rewriteResolvedDependencyImports(
  fileContent: string,
  transformedDeps: TransformedModuleDependency[],
): string {
  const replacements: SourceSpanReplacement[] = transformedDeps.map((dep) => ({
    start: dep.start,
    end: dep.end,
    expected: dep.full,
    replacement: `from ${JSON.stringify(toFileUrl(dep.depTempPath).href)}`,
  }));
  return replaceSourceSpans(fileContent, replacements);
}

async function getSafePathInfo(
  path: string,
  canonicalProjectDir: string | undefined,
  adapter: RuntimeAdapter,
): Promise<{ isFile: boolean; isDirectory: boolean }> {
  try {
    const info = adapter.fs.lstat ? await adapter.fs.lstat(path) : await adapter.fs.stat(path);
    if (info.isSymlink) {
      throw new TypeError("Local module dependency cannot be a symbolic link");
    }

    if (adapter.fs.realPath && canonicalProjectDir) {
      const canonicalPath = await adapter.fs.realPath(path);
      if (!isPathWithinRoot(canonicalPath, canonicalProjectDir)) {
        throw new TypeError("Local module dependency must stay inside the project");
      }
    }

    return { isFile: info.isFile, isDirectory: info.isDirectory };
  } catch (error) {
    if (isNotFoundError(error)) return { isFile: false, isDirectory: false };
    throw error;
  }
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
