import { dirname, join, normalize, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { parallelMap, rendererLogger } from "#veryfront/utils";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
  type StaticImportSpan,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";
import { findSourceFile } from "../file-resolver/index.ts";

const logger = rendererLogger.component("module-loader");
const MAX_IMPORTS_PER_KIND = 500;

/**
 * Collect one kind of import span, failing closed past the per-kind bound.
 *
 * The scanner is asked for one span more than the bound so that an over-budget
 * module is rejected rather than resolved from a truncated prefix: every span
 * collected here is rewritten to a temp-file URL later, so dropping the tail
 * would leave those imports pointing at specifiers that no longer resolve.
 */
function collectBoundedSpans(
  scan: (maxMatches: number) => StaticImportSpan[],
  kind: string,
): StaticImportSpan[] {
  const spans = scan(MAX_IMPORTS_PER_KIND + 1);
  if (spans.length > MAX_IMPORTS_PER_KIND) {
    throw new RangeError(
      `Module contains more than ${MAX_IMPORTS_PER_KIND} ${kind} imports`,
    );
  }
  return spans;
}

type AliasImport = {
  full: string;
  path: string;
  start: number;
  end: number;
  isDynamic: boolean;
  isSideEffect: boolean;
};
type RelativeImport = {
  full: string;
  path: string;
  fromDir: string;
  start: number;
  end: number;
  isDynamic: boolean;
  isSideEffect: boolean;
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
  /** True when discovered in a bare `import "…"` statement. */
  isSideEffect?: boolean;
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
  const toAlias = (isDynamic: boolean, isSideEffect = false) =>
  (
    { original, path, start, end }: {
      original: string;
      path: string;
      start: number;
      end: number;
    },
  ): AliasImport => ({ full: original, path, start, end, isDynamic, isSideEffect });

  return [
    ...collectBoundedSpans(
      (maxMatches) => findStaticImportFromSpans(fileContent, matchAlias, maxMatches),
      "static alias",
    ).map(toAlias(false)),
    ...collectBoundedSpans(
      (maxMatches) => findStaticSideEffectImportSpans(fileContent, matchAlias, maxMatches),
      "side-effect alias",
    ).map(toAlias(false, true)),
    ...collectBoundedSpans(
      (maxMatches) => findDynamicImportSpans(fileContent, matchAlias, maxMatches),
      "dynamic alias",
    ).map(toAlias(true)),
  ];
}

function collectRelativeImports(fileContent: string, fileDir: string): RelativeImport[] {
  const toRelative = (isDynamic: boolean, isSideEffect = false) =>
  (
    { original, path, start, end }: {
      original: string;
      path: string;
      start: number;
      end: number;
    },
  ): RelativeImport => ({
    full: original,
    path,
    fromDir: fileDir,
    start,
    end,
    isDynamic,
    isSideEffect,
  });

  return [
    ...collectBoundedSpans(
      (maxMatches) => findStaticImportFromSpans(fileContent, matchRelative, maxMatches),
      "static relative",
    ).map(toRelative(false)),
    ...collectBoundedSpans(
      (maxMatches) => findStaticSideEffectImportSpans(fileContent, matchRelative, maxMatches),
      "side-effect relative",
    ).map(toRelative(false, true)),
    ...collectBoundedSpans(
      (maxMatches) => findDynamicImportSpans(fileContent, matchRelative, maxMatches),
      "dynamic relative",
    ).map(toRelative(true)),
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
    isSideEffect: imp.isSideEffect,
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
  const replacements: SourceSpanReplacement[] = transformedDeps.map((dep) => {
    const moduleUrl = toFileUrl(dep.depTempPath).href;
    return {
      start: dep.start,
      end: dep.end,
      expected: dep.full,
      // A dynamic span covers only the quoted specifier, a side-effect span
      // covers the bare import, and a static binding span covers `from "…"`.
      replacement: dep.isSideEffect
        ? `import "${moduleUrl}"`
        : dep.isDynamic
        ? `"${moduleUrl}"`
        : `from "${moduleUrl}"`,
    };
  });
  return replaceSourceSpans(fileContent, replacements);
}
