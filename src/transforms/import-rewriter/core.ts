import {
  applyComputedDynamicImportPinning,
  applyImportEdits,
  isFilesystemImportSpecifier,
  parseImportEdits,
} from "./import-edit.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { relativeToProjectDir } from "./project-paths.ts";
import {
  appendDependencyPinningPathKey,
  appendSameOriginDependencyPinningPathKey,
  appendSameOriginSSRDependencyPinningKey,
  normalizeExtension,
} from "./url-builder.ts";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "./types.ts";

export interface TransformCoreInput {
  code: string;
  context: RewriteContext;
  strategies: ImportRewriteStrategy[];
}

function pinSameOriginModuleUrl(
  specifier: string,
  ctx: RewriteContext,
): string | null {
  if (
    !ctx.dependencyPinningCacheKey?.startsWith("on:")
  ) {
    return null;
  }

  const pinned = ctx.target === "browser"
    ? appendSameOriginDependencyPinningPathKey(
      specifier,
      ctx.dependencyPinningCacheKey,
      ctx.moduleServerOrigin,
    )
    : appendSameOriginSSRDependencyPinningKey(
      specifier,
      ctx.dependencyPinningCacheKey,
      ctx.moduleServerOrigin,
    );
  return pinned === specifier ? null : pinned;
}

export async function rewriteWithImportRewriteCore(input: TransformCoreInput): Promise<string> {
  const parsed = await parseImportEdits(input.code);
  if (parsed.imports.length === 0 && parsed.computedDynamicImports.length === 0) {
    return input.code;
  }

  const rewrites = new Map<number, { specifier?: string | null; statement?: string }>();
  const guardFrameworkImports = input.strategies.some((strategy) => strategy.name === "veryfront");

  for (let i = 0; i < parsed.imports.length; i++) {
    const imp = parsed.imports[i]!;
    if (
      guardFrameworkImports && input.context.target === "ssr" &&
      isFilesystemImportSpecifier(imp.specifier) &&
      !input.context.allowedFilesystemImportSpecifiers?.has(imp.specifier)
    ) {
      throw SECURITY_VIOLATION.create({
        detail: `Project-authored filesystem module import is not allowed: ${imp.specifier}`,
      });
    }
    const result = rewriteOne(imp.specifier, imp, input.context, input.strategies);

    if (result.specifier !== null || result.statement !== undefined) {
      rewrites.set(i, result);
    }
  }

  const rewritten = rewrites.size === 0 ? input.code : applyImportEdits(parsed, rewrites);
  const pinningEnabled = input.context.dependencyPinningCacheKey?.startsWith("on:") === true;
  const isBrowserPinning = input.context.target === "browser" && pinningEnabled;
  const isCrossProjectSSRPinning = input.context.target === "ssr" &&
    pinningEnabled &&
    input.context.moduleServerUrl?.includes("/_vf_modules/_cross/") === true;
  if (!isBrowserPinning && !isCrossProjectSSRPinning && !guardFrameworkImports) {
    return rewritten;
  }

  const computedParsed = rewrites.size === 0 ? parsed : await parseImportEdits(rewritten);
  const projectRelativeFilePath = relativeToProjectDir(
    input.context.filePath,
    input.context.projectDir,
  );
  const moduleServerPathBase = input.context.moduleServerUrl?.includes("/_vf_modules")
    ? input.context.moduleServerUrl.replace(/\/+$/, "")
    : undefined;
  const moduleServerBase = moduleServerPathBase ?? "/_vf_modules";
  const relativeFilePath = projectRelativeFilePath ??
    (moduleServerPathBase !== undefined &&
        !input.context.filePath.startsWith("/")
      ? input.context.filePath
      : null);
  const modulePath = !pinningEnabled || relativeFilePath === null
    ? undefined
    : appendDependencyPinningPathKey(
      `${moduleServerBase}/${normalizeExtension(relativeFilePath)}`,
      input.context.dependencyPinningCacheKey,
    );
  return applyComputedDynamicImportPinning(computedParsed, modulePath, {
    ssr: isCrossProjectSSRPinning,
    guardFrameworkImports,
    guardFilesystemImports: guardFrameworkImports && input.context.target === "ssr",
  });
}

function rewriteOne(
  specifier: string,
  info: ImportSpecifierInfo,
  ctx: RewriteContext,
  strategies: ImportRewriteStrategy[],
): RewriteResult {
  const pinnedModuleUrl = pinSameOriginModuleUrl(specifier, ctx);
  if (pinnedModuleUrl !== null) return { specifier: pinnedModuleUrl };

  for (const strategy of strategies) {
    if (!strategy.matches(specifier, ctx)) continue;

    const result = strategy.rewrite(info, ctx);
    if (result.specifier !== null || result.statement !== undefined) return result;
  }

  return { specifier: null };
}
