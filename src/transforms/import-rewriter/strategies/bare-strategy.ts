/**
 * Bare npm import rewriting strategy.
 *
 * Priority: 2
 * Handles: lodash, @tanstack/react-query, etc.
 */

import { SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import { isCrossProjectImport } from "#veryfront/transforms/shared/cross-project-import.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import {
  describeServerExternalBrowserViolation,
  isConfiguredServerExternalPackage,
  isServerOnlyPackage,
} from "#veryfront/transforms/shared/server-only-packages.ts";
import { rendererLogger } from "#veryfront/utils";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildEsmShUrl, TAILWIND_VERSION } from "../url-builder.ts";
import {
  isPinningEnabledForRewrite,
  resolveDependencyPinForImport,
} from "../dependency-resolution.ts";

const logger = rendererLogger.component("esm");

const unversionedImportsWarned = new Set<string>();

function hasVersionSpecifier(specifier: string): boolean {
  // Use the package specifier parser so that dist-tags (e.g. @next, @beta,
  // @canary) are recognised as version specifiers and are never overridden by
  // a cached numeric pin.
  return parseBarePackageSpecifier(specifier)?.version != null;
}

function warnUnversionedImport(specifier: string, projectId: string): void {
  const key = `${projectId}:${specifier}`;
  if (unversionedImportsWarned.has(key)) return;

  unversionedImportsWarned.add(key);

  const isScoped = specifier.startsWith("@");
  const parts = specifier.split("/");
  const packageName = isScoped ? parts.slice(0, 2).join("/") : (parts[0] ?? "");

  logger.warn("Unversioned import may cause reproducibility issues", {
    import: specifier,
    projectId,
    suggestion: `Pin version: import '${packageName}@x.y.z'`,
    help: `Run 'npm info ${packageName} version' to find current version`,
  });
}

/**
 * Resolve a pinned version for a bare package when the flag is on.
 * Exact declarations are returned immediately. Ranges, tags, and verified
 * undeclared imports retain the unversioned fallback while the platform
 * resolver normalizes and persists an exact declaration.
 */
function resolvePinnedVersion(
  packageName: string,
  ctx: RewriteContext,
): string | undefined {
  return resolveDependencyPinForImport(packageName, ctx);
}

export class BareStrategy implements ImportRewriteStrategy {
  readonly name = "bare";
  readonly priority = 2;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    if (
      /^https?:\/\//i.test(specifier) ||
      specifier.startsWith("//") ||
      specifier.startsWith("./") ||
      specifier.startsWith("../") ||
      specifier.startsWith("/") ||
      specifier.startsWith("@/") ||
      specifier.startsWith("#") ||
      specifier.startsWith("veryfront") ||
      specifier === "react" ||
      specifier === "react-dom" ||
      specifier.startsWith("react/") ||
      specifier.startsWith("react-dom/") ||
      specifier.startsWith("node:") ||
      isCrossProjectImport(specifier)
    ) {
      return false;
    }

    return true;
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    // Normalise an explicit Deno `npm:` prefix (`npm:zod@4.0.0`): the package
    // underneath is what matters for both the server-only check and the esm.sh
    // rewrite. The `npm:` scheme alone does not imply server-only.
    const isNpmScheme = info.specifier.startsWith("npm:");
    const bareSpecifier = isNpmScheme ? info.specifier.slice("npm:".length) : info.specifier;
    const parsed = parseBarePackageSpecifier(bareSpecifier);

    if (
      ctx.target === "ssr" &&
      parsed &&
      !parsed.version &&
      isPinningEnabledForRewrite(ctx)
    ) {
      // The post-pipeline SSR adapter owns the live resolution/scheduling.
      // Record the same unresolved declaration here so pipeline/outer caches
      // can replay it without introducing a second fresh-miss write.
      resolveDependencyPinForImport(parsed.packageName, {
        ...ctx,
        dependencyResolutionObservationOnly: true,
      });
    }

    // Explicit declarations are a project-owned server/client boundary. Unlike
    // the compatibility list below, crossing that boundary is actionable and
    // must fail during the browser transform instead of leaving a bare import
    // that crashes later during hydration.
    if (
      ctx.target === "browser" &&
      parsed &&
      isConfiguredServerExternalPackage(parsed.packageName, ctx.serverExternalPackages)
    ) {
      const violation = describeServerExternalBrowserViolation(
        info.specifier,
        ctx.filePath,
        ctx.projectDir,
      );
      throw SERVER_ONLY_IN_CLIENT.create({
        message: violation.message,
        detail:
          `Declared server external package reached a browser transform: ${parsed.packageName}`,
        instance: violation.sourceIdentity,
        context: { packageName: parsed.packageName },
      });
    }

    // Known server-only packages (`redis`, `pg`, …), including their explicit
    // `npm:` form, must never be routed through esm.sh — they only run
    // server-side and either fail to build for the browser or produce a client
    // that cannot connect. Leave them external for every target so the runtime
    // resolves them natively (node_modules on Node, npm: on Deno). The
    // framework's adapters only `import()` these behind a lazy, configured code
    // path, so an app that does not use the backend never loads them at all.
    if (parsed && isServerOnlyPackage(parsed.packageName, ctx.serverExternalPackages)) {
      return { specifier: null };
    }

    if (ctx.target === "ssr") {
      // On the server an installed package is resolved by name from node_modules
      // (Node) — a bare specifier carrying an explicit version, e.g.
      // `next-themes@0.4.6`, has no matching `node_modules/next-themes@0.4.6`
      // entry, so `import()` never resolves it and the cold module load stalls
      // to a timeout/500. With dependency pinning enabled, preserve the
      // author's inline version by resolving it through esm.sh immediately.
      // This keeps the later SSR adapter from mistaking the stripped package
      // name for an unversioned import and replacing it with package.json's
      // exact pin. Flag-off requests retain the installed-package fallback.
      // `npm:` specifiers keep their native form — the Deno resolver
      // understands their versions.
      if (!isNpmScheme && parsed?.version) {
        if (isPinningEnabledForRewrite(ctx)) {
          return {
            specifier: buildEsmShUrl(
              parsed.packageName,
              parsed.version,
              parsed.subpath ?? undefined,
              { external: ["react"] },
            ),
          };
        }
        return { specifier: `${parsed.packageName}${parsed.subpath ?? ""}` };
      }
      return { specifier: null };
    }

    if (parsed == null) {
      return { specifier: null };
    }

    const packageName = parsed.packageName;
    let version = parsed.version ?? undefined;
    const subpath = parsed.subpath ?? undefined;

    if (packageName === "tailwindcss") {
      version = TAILWIND_VERSION;
    } else if (!hasVersionSpecifier(bareSpecifier)) {
      if (isPinningEnabledForRewrite(ctx)) {
        // Version-selection ladder (flag ON):
        // 1. inline version in specifier (already captured above as version)
        // 2. exact package.json pin -> resolved here
        // 3. current unversioned fallback (warn as before)
        const pinned = resolvePinnedVersion(packageName, ctx);
        if (pinned) {
          version = pinned;
        } else {
          warnUnversionedImport(bareSpecifier, ctx.projectId);
        }
      } else {
        warnUnversionedImport(bareSpecifier, ctx.projectId);
      }
    }

    const url = buildEsmShUrl(packageName, version, subpath, {
      external: ["react", "react-dom"],
    });

    return { specifier: url };
  }
}

export const bareStrategy = new BareStrategy();
