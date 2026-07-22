import { dirname, join, normalize } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { parallelMap, rendererLogger } from "#veryfront/utils";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";
import { findSourceFile } from "../file-resolver/index.ts";

const logger = rendererLogger.component("module-loader");

type AliasImport = {
  full: string;
  path: string;
  start: number;
  end: number;
  isDynamic: boolean;
};
type RelativeImport = {
  full: string;
  path: string;
  fromDir: string;
  start: number;
  end: number;
  isDynamic: boolean;
};

/** Resolved local module dependency discovered in a source module. */
export type ResolvedModuleDependency = {
  full: string;
  path: string;
  start: number;
  end: number;
  relativePath: string;
  depFilePath: string | null;
  isLocalLib: boolean;
  /** True when discovered inside `import("…")` rather than a static import. */
  isDynamic: boolean;
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

const matchAlias = (specifier: string) => specifier.startsWith("@/") ? specifier : null;
const matchRelative = (specifier: string) => specifier.match(/^(\.\.?\/[^?]+)(?:\?.*)?$/)?.[1];

function collectAliasImports(fileContent: string): AliasImport[] {
  const toAlias = (isDynamic: boolean) =>
  (
    { original, path, start, end }: {
      original: string;
      path: string;
      start: number;
      end: number;
    },
  ): AliasImport => ({ full: original, path, start, end, isDynamic });

  return [
    ...findStaticImportFromSpans(fileContent, matchAlias).map(toAlias(false)),
    ...findDynamicImportSpans(fileContent, matchAlias).map(toAlias(true)),
  ];
}

function collectRelativeImports(fileContent: string, fileDir: string): RelativeImport[] {
  const toRelative = (isDynamic: boolean) =>
  (
    { original, path, start, end }: {
      original: string;
      path: string;
      start: number;
      end: number;
    },
  ): RelativeImport => ({ full: original, path, fromDir: fileDir, start, end, isDynamic });

  return [
    ...findStaticImportFromSpans(fileContent, matchRelative).map(toRelative(false)),
    ...findDynamicImportSpans(fileContent, matchRelative).map(toRelative(true)),
  ]
    // Ignore already-transformed file:// imports.
    .filter((imp) => !imp.path.includes("file://"));
}

async function resolveAliasImport(
  imp: AliasImport,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ResolvedModuleDependency> {
  const relativePath = imp.path.substring(2); // Remove @/ prefix.

  const depFilePath = (await findSourceFile(relativePath, projectDir, adapter)) ??
    (await findSourceFile(`components/${relativePath}`, projectDir, adapter));

  return { ...imp, relativePath, depFilePath, isLocalLib: false };
}

async function resolveRelativeImport(
  imp: RelativeImport,
  adapter: RuntimeAdapter,
): Promise<ResolvedModuleDependency> {
  const basePath = normalize(join(imp.fromDir, imp.path));

  logger.debug("Resolving relative import:", {
    path: imp.path,
    fromDir: imp.fromDir,
    basePath,
  });

  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  let depFilePath: string | null = null;

  if (await adapter.fs.exists(basePath)) {
    const stat = await adapter.fs.stat(basePath);
    if (!stat.isDirectory) {
      depFilePath = basePath;
    }
  }

  if (!depFilePath) {
    for (const ext of extensions) {
      const pathWithExt = basePath + ext;
      if (await adapter.fs.exists(pathWithExt)) {
        depFilePath = pathWithExt;
        break;
      }
    }
  }

  if (!depFilePath) {
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (await adapter.fs.exists(indexPath)) {
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
    isDynamic: imp.isDynamic,
  };
}

/** Resolves @/ alias and relative local imports from a source module. */
export async function resolveModuleDependencies(
  input: ResolveModuleDependenciesInput,
): Promise<ResolvedModuleDependency[]> {
  const fileDir = dirname(input.filePath);
  const aliasImports = collectAliasImports(input.fileContent);
  const relativeImports = collectRelativeImports(input.fileContent, fileDir);

  logger.debug("Processing file:", {
    filePath: input.filePath,
    aliasImportsCount: aliasImports.length,
    relativeImportsCount: relativeImports.length,
    aliasImports: aliasImports.map((i) => i.path),
    relativeImports: relativeImports.map((i) => i.path),
  });

  const resolvedAliasDeps = await parallelMap(
    aliasImports,
    (imp) => resolveAliasImport(imp, input.projectDir, input.adapter),
  );
  const resolvedRelativeDeps = await parallelMap(
    relativeImports,
    (imp) => resolveRelativeImport(imp, input.adapter),
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
    // A dynamic span covers only the quoted specifier; a static one covers the
    // whole `from "…"` clause.
    replacement: dep.isDynamic ? `"file://${dep.depTempPath}"` : `from "file://${dep.depTempPath}"`,
  }));
  return replaceSourceSpans(fileContent, replacements);
}
