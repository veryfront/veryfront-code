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

    // SSR uses /_vf_modules/ paths for HTTP module resolution
    if (ctx.target === "ssr") {
      let normalizedPath = normalizeExtension(path);
      // Add .js if no extension present
      if (!/\.(tsx?|jsx?|mjs|cjs|mdx|css|js)$/.test(normalizedPath)) {
        normalizedPath = `${normalizedPath}.js`;
      }
      return { specifier: `/_vf_modules/${normalizedPath}` };
    }

    // Browser: Use /_vf_modules/ absolute paths when moduleServerUrl is configured.
    // This avoids relative path calculation issues when the file index path structure
    // doesn't match the module path structure (e.g., index returns "elements/Textarea.tsx"
    // but module path is "_vf_modules/components/elements/Textarea.js").
    if (ctx.moduleServerUrl) {
      let normalizedPath = normalizeExtension(path);
      if (!/\.(tsx?|jsx?|mjs|cjs|mdx|css|js)$/.test(normalizedPath)) {
        normalizedPath = `${normalizedPath}.js`;
      }
      return { specifier: `${ctx.moduleServerUrl}/${normalizedPath}` };
    }

    // Fallback: Use relative paths when no module server is configured.
    // This is used for local development without a module server.
    const relativeFilePath = this.getRelativeFilePath(ctx.filePath, ctx.projectDir);
    const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
    const depth = fileDir.split("/").filter(Boolean).length;

    let relativePath = depth === 0 ? `./${path}` : `${"../".repeat(depth)}${path}`;

    if (!/\.(tsx?|jsx?|mjs|cjs|mdx|css)$/.test(relativePath)) {
      relativePath = `${relativePath}.js`;
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
