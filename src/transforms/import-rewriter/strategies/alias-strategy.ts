import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { appendDependencyPinningPathKey, normalizeExtension } from "../url-builder.ts";
import { getProjectRelativePath } from "../project-paths.ts";

/** Rewrite a project alias through the canonical SSR module-path rule. */
export function rewriteSsrProjectAliasSpecifier(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  let normalizedPath = normalizeExtension(specifier.slice(2));
  if (!/\.(tsx?|jsx?|mjs|cjs|mdx|css)$/.test(normalizedPath)) {
    normalizedPath = `${normalizedPath}.js`;
  }
  return `/_vf_modules/${normalizedPath}`;
}

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
      // The SSR adapter adds `ssr`, routing, cache-buster, and dependency
      // snapshot params together after this strategy runs. Keeping this URL
      // query-free ensures its `.js` matcher still sees the edge.
      return { specifier: rewriteSsrProjectAliasSpecifier(info.specifier) ?? info.specifier };
    }

    // Browser: Use /_vf_modules/ absolute paths when moduleServerUrl is configured.
    // This avoids relative path calculation issues when the file index path structure
    // doesn't match the module path structure (e.g., index returns "elements/Textarea.tsx"
    // but module path is "_vf_modules/components/elements/Textarea.js").
    if (ctx.moduleServerUrl) {
      let normalizedPath = normalizeExtension(path);
      if (!/\.(tsx?|jsx?|mjs|cjs|mdx|css)$/.test(normalizedPath)) {
        normalizedPath = `${normalizedPath}.js`;
      }
      return {
        specifier: appendDependencyPinningPathKey(
          `${ctx.moduleServerUrl}/${normalizedPath}`,
          ctx.dependencyPinningCacheKey,
        ),
      };
    }

    // Fallback: Use relative paths when no module server is configured.
    // This is used for local development without a module server.
    const relativeFilePath = getProjectRelativePath(ctx.filePath, ctx.projectDir);
    const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
    const depth = fileDir.split("/").filter(Boolean).length;

    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    let relativePath = normalizeExtension(`${prefix}${path}`);

    if (!/\.(tsx?|jsx?|mjs|cjs|mdx|css)$/.test(relativePath)) {
      relativePath = `${relativePath}.js`;
    }

    // Browser-relative edges inherit the snapshot from the path-scoped parent
    // module URL. Adding a query token here would create an ambiguous
    // path+query request at the strict module endpoint.
    return { specifier: relativePath };
  }
}

export const aliasStrategy = new AliasStrategy();
