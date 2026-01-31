import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { normalizeExtension } from "../url-builder.ts";

export class AliasStrategy implements ImportRewriteStrategy {
  readonly name = "alias";
  readonly priority = 1;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return specifier.startsWith("@/");
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const path = info.specifier.slice(2);
    const relativeFilePath = this.getRelativeFilePath(ctx.filePath, ctx.projectDir);
    const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
    const depth = fileDir.split("/").filter(Boolean).length;

    let relativePath = depth === 0 ? `./${path}` : `${"../".repeat(depth)}${path}`;

    if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
      relativePath = `${relativePath}.js`;
    } else if (ctx.target === "ssr") {
      relativePath = normalizeExtension(relativePath);
    }

    return { specifier: relativePath };
  }

  private getRelativeFilePath(filePath: string, projectDir: string): string {
    const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

    if (filePath.startsWith(normalizedProjectDir)) {
      return filePath.substring(normalizedProjectDir.length + 1);
    }

    if (!filePath.startsWith("/")) return filePath;

    const pathParts = filePath.split("/");
    const projectParts = normalizedProjectDir.split("/");
    const lastProjectPart = projectParts.at(-1);
    const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;

    if (projectIndex >= 0) {
      return pathParts.slice(projectIndex + 1).join("/");
    }

    return filePath;
  }
}

export const aliasStrategy = new AliasStrategy();
