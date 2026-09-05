import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { appendDependencyPinningPathKey, normalizeExtension } from "../url-builder.ts";
import { getProjectRelativePath } from "../project-paths.ts";
import {
  assertContainedProjectAliasPath,
  isContainedProjectAliasPath,
} from "#veryfront/transforms/shared/alias-containment.ts";

// Every alias rewrite here composes its URL by concatenating the authored `@/`
// path onto a prefix, so containment has to be checked before composition.
// Without it, `@/../_veryfront/modules/foo` is emitted as
// `/_vf_modules/../_veryfront/modules/foo.js` and the browser or the SSR
// importer normalizes it straight back out of the transport, turning the
// import into a same-origin fetch of an arbitrary path that is then cached as
// an executable module. `transforms/esm/specifier-resolver.ts` already refuses
// the same input; the rule itself lives in
// `transforms/shared/alias-containment.ts` so the two cannot drift.

/**
 * Rewrite a project alias through the canonical SSR module-path rule, or null
 * when the specifier is not a `@/` alias or its path would leave the module
 * transport.
 *
 * This returns null rather than throwing on an uncontained path because it is
 * also used for read-only classification — `isUnresolvedTenantImport` in
 * `rendering/orchestrator/module-loader` normalizes an already-failed
 * specifier through it — where a throw would replace a diagnostic with a
 * crash. Callers that actually emit the result reject the specifier instead:
 * `AliasStrategy.rewrite` below throws on the same input.
 */
export function rewriteSsrProjectAliasSpecifier(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  if (!isContainedProjectAliasPath(specifier.slice(2))) return null;
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
    assertContainedProjectAliasPath(path);

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
