import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import {
  appendDependencyPinningKey,
  appendDependencyPinningPathKey,
  buildModuleServerUrl,
  normalizeExtension,
} from "../url-builder.ts";
import { getProjectRelativePath } from "../project-paths.ts";

export class RelativeStrategy implements ImportRewriteStrategy {
  readonly name = "relative";
  readonly priority = 3;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return specifier.startsWith("./") || specifier.startsWith("../");
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const { specifier } = info;

    const rewrittenSpecifier = /\.(tsx?|jsx)$/.test(specifier)
      ? normalizeExtension(specifier)
      : specifier;

    // For both SSR and browser: if moduleServerUrl is available, resolve to module server URL.
    // This is critical for compiled Deno binaries where framework files are served via module server.
    // Without this, relative imports in framework files would resolve to compiled binary paths,
    // causing multiple React instances (bundled-in vs esm.sh) and breaking hooks.
    if (ctx.moduleServerUrl) {
      const relativeFilePath = getProjectRelativePath(ctx.filePath, ctx.projectDir);
      const separatorIndex = relativeFilePath.lastIndexOf("/");
      const fileDir = separatorIndex === -1 ? "" : relativeFilePath.slice(0, separatorIndex);
      const resolvedPath = this.resolveRelativePath(fileDir, rewrittenSpecifier);
      const moduleUrl = buildModuleServerUrl(ctx.moduleServerUrl, resolvedPath);
      return {
        specifier: ctx.target === "browser"
          ? appendDependencyPinningPathKey(
            moduleUrl,
            ctx.dependencyPinningCacheKey,
          )
          : appendDependencyPinningKey(
            moduleUrl,
            ctx.dependencyPinningCacheKey,
          ),
      };
    }

    if (/\.(tsx?|jsx|mdx)$/.test(specifier)) {
      return { specifier: rewrittenSpecifier };
    }

    // Browser-relative edges inherit the snapshot from the path-scoped parent
    // module URL. Keeping them query-free also covers computed dynamic imports,
    // which the lexer deliberately cannot rewrite.
    if (
      ctx.target === "browser" &&
      ctx.dependencyPinningCacheKey?.startsWith("on:")
    ) {
      return { specifier: null };
    }

    return { specifier: null };
  }

  private resolveRelativePath(currentDir: string, importPath: string): string {
    const resolvedParts = currentDir.split("/").filter(Boolean);

    for (const part of importPath.split("/").filter(Boolean)) {
      if (part === "..") resolvedParts.pop();
      else if (part !== ".") resolvedParts.push(part);
    }

    return resolvedParts.join("/");
  }
}

export const relativeStrategy = new RelativeStrategy();
