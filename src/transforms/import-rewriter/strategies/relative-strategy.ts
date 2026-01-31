import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildModuleServerUrl, normalizeExtension } from "../url-builder.ts";

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
      const relativeFilePath = this.getRelativeFilePath(ctx.filePath, ctx.projectDir);
      const fileDir = relativeFilePath.slice(0, relativeFilePath.lastIndexOf("/"));
      const resolvedPath = this.resolveRelativePath(fileDir, rewrittenSpecifier);
      return { specifier: buildModuleServerUrl(ctx.moduleServerUrl, resolvedPath) };
    }

    if (/\.(tsx?|jsx|mdx)$/.test(specifier)) return { specifier: rewrittenSpecifier };

    return { specifier: null };
  }

  private getRelativeFilePath(filePath: string, projectDir: string): string {
    const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

    if (filePath.startsWith(normalizedProjectDir)) {
      return filePath.slice(normalizedProjectDir.length + 1);
    }

    if (!filePath.startsWith("/")) return filePath;

    const pathParts = filePath.split("/");
    const projectParts = normalizedProjectDir.split("/");
    const lastProjectPart = projectParts.at(-1);
    const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;

    if (projectIndex >= 0) return pathParts.slice(projectIndex + 1).join("/");

    return filePath;
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
