/**
 * Relative import rewriting strategy.
 *
 * Priority: 3
 * Handles: ./foo, ../bar
 */

import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.js";
import { buildModuleServerUrl, normalizeExtension } from "../url-builder.js";

export class RelativeStrategy implements ImportRewriteStrategy {
  readonly name = "relative";
  readonly priority = 3;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return specifier.startsWith("./") || specifier.startsWith("../");
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const specifier = info.specifier;

    if (ctx.target === "ssr") {
      // SSR: Normalize extension to .js
      if (/\.(tsx?|jsx|mdx)$/.test(specifier)) {
        return { specifier: normalizeExtension(specifier) };
      }
      return { specifier: null };
    }

    // Browser: Resolve to module server URL
    const rewrittenSpecifier = /\.(tsx?|jsx)$/.test(specifier)
      ? normalizeExtension(specifier)
      : specifier;

    if (!ctx.moduleServerUrl) {
      return { specifier: rewrittenSpecifier };
    }

    // Resolve the relative path from the current file
    const relativeFilePath = this.getRelativeFilePath(ctx.filePath, ctx.projectDir);
    const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
    const resolvedPath = this.resolveRelativePath(fileDir, rewrittenSpecifier);

    return { specifier: buildModuleServerUrl(ctx.moduleServerUrl, resolvedPath) };
  }

  private getRelativeFilePath(filePath: string, projectDir: string): string {
    const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

    if (filePath.startsWith(normalizedProjectDir)) {
      return filePath.substring(normalizedProjectDir.length + 1);
    }

    if (!filePath.startsWith("/")) return filePath;

    const pathParts = filePath.split("/");
    const projectParts = normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];
    const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;

    if (projectIndex >= 0) {
      return pathParts.slice(projectIndex + 1).join("/");
    }

    return filePath;
  }

  private resolveRelativePath(currentDir: string, importPath: string): string {
    const baseParts = currentDir.split("/").filter(Boolean);
    const resolvedParts = [...baseParts];

    for (const part of importPath.split("/").filter(Boolean)) {
      if (part === "..") resolvedParts.pop();
      else if (part !== ".") resolvedParts.push(part);
    }

    return resolvedParts.join("/");
  }
}

export const relativeStrategy = new RelativeStrategy();
