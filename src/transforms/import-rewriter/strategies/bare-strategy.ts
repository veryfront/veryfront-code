/**
 * Bare npm import rewriting strategy.
 *
 * Priority: 2
 * Handles: lodash, @tanstack/react-query, etc.
 */

import { rendererLogger } from "#veryfront/utils";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildEsmShUrl, TAILWIND_VERSION } from "../url-builder.ts";
import { parseBarePackageSpecifier } from "../../shared/package-specifier.ts";
import { isServerOnlyPackage } from "../../shared/server-only-packages.ts";
import { isCrossProjectImport } from "#veryfront/transforms/shared/cross-project-import.ts";
import {
  getProjectDependenciesSync,
  stripSemverRange,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  getCachedNpmVersion,
  isDependencyPinningEnabled,
  isExactSemver,
  postDependencyResolution,
  scheduleNpmVersionResolution,
} from "#veryfront/transforms/esm/npm-registry-client.ts";

const logger = rendererLogger.component("esm");

const unversionedImportsWarned = new Set<string>();

function hasVersionSpecifier(specifier: string): boolean {
  return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
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
 * Priority: package.json pin -> npm registry cache -> undefined (fallback).
 * Schedules a background registry fetch when both caches are cold.
 */
function resolvePinnedVersion(
  packageName: string,
  ctx: RewriteContext,
): string | undefined {
  // 1. package.json pin from the warm in-process cache.
  const allDeps = getProjectDependenciesSync(ctx.projectDir);
  const rawPin = allDeps?.[packageName];
  if (rawPin) {
    const stripped = stripSemverRange(rawPin);
    // Only use if it resolves to an exact version; compound ranges like
    // ">=1.0.0 <2.0.0" would produce a malformed URL, so fall through.
    if (isExactSemver(stripped)) return stripped;
  }

  // 2. npm registry cache (populated by a prior background fetch).
  const registryVersion = getCachedNpmVersion(packageName, ctx.projectDir);
  if (registryVersion) return registryVersion;

  // 3. Cache cold: schedule a background resolution for the next render.
  scheduleNpmVersionResolution(packageName, undefined, ctx.projectDir, (version) => {
    void postDependencyResolution(ctx.projectId, [`${packageName}@${version}`]);
  });

  return undefined;
}

export class BareStrategy implements ImportRewriteStrategy {
  readonly name = "bare";
  readonly priority = 2;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    if (
      specifier.startsWith("http://") ||
      specifier.startsWith("https://") ||
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

    // Known server-only packages (`redis`, `pg`, …), including their explicit
    // `npm:` form, must never be routed through esm.sh — they only run
    // server-side and either fail to build for the browser or produce a client
    // that cannot connect. Leave them external for every target so the runtime
    // resolves them natively (node_modules on Node, npm: on Deno). The
    // framework's adapters only `import()` these behind a lazy, configured code
    // path, so an app that does not use the backend never loads them at all.
    if (parsed && isServerOnlyPackage(parsed.packageName)) {
      return { specifier: null };
    }

    if (ctx.target === "ssr") {
      // On the server an installed package is resolved by name from node_modules
      // (Node) — a bare specifier carrying an explicit version, e.g.
      // `next-themes@0.4.6`, has no matching `node_modules/next-themes@0.4.6`
      // entry, so `import()` never resolves it and the cold module load stalls
      // to a timeout/500. The version is only meaningful for the browser's
      // esm.sh URL, so strip it here and resolve the installed package by name
      // (preserving any subpath). `npm:` specifiers keep their version — the
      // Deno npm resolver understands them.
      if (!isNpmScheme && parsed?.version) {
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
      if (isDependencyPinningEnabled()) {
        // Version-selection ladder (flag ON):
        // 1. inline version in specifier (already captured above as version)
        // 2. package.json pin or npm registry cache -> resolved here
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
