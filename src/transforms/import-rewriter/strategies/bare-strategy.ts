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
import { isCrossProjectImport } from "../../shared/cross-project-import.ts";

const logger = rendererLogger.component("esm");

const unversionedImportsWarned = new Set<string>();
const MAX_UNVERSIONED_IMPORT_WARNINGS = 10_000;

function hasVersionSpecifier(specifier: string): boolean {
  return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
}

function warnUnversionedImport(
  specifier: string,
  packageName: string,
  projectId: string,
): void {
  const key = `${projectId}:${specifier}`;
  if (unversionedImportsWarned.has(key)) return;

  if (unversionedImportsWarned.size >= MAX_UNVERSIONED_IMPORT_WARNINGS) {
    const oldestKey = unversionedImportsWarned.values().next().value;
    if (oldestKey !== undefined) unversionedImportsWarned.delete(oldestKey);
  }
  unversionedImportsWarned.add(key);

  logger.warn("Unversioned import may cause reproducibility issues", {
    package: packageName,
    suggestion: `Pin version: import '${packageName}@x.y.z'`,
    help: `Run 'npm info ${packageName} version' to find current version`,
  });
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
      specifier.startsWith("node:")
    ) {
      return false;
    }

    return !isCrossProjectImport(specifier) && parseBarePackageSpecifier(specifier) !== null;
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (ctx.target === "ssr") return { specifier: null };

    const parsed = parseBarePackageSpecifier(info.specifier);
    if (parsed == null) {
      return { specifier: null };
    }

    const packageName = parsed.packageName;
    let version = parsed.version ?? undefined;
    const subpath = parsed.subpath ?? undefined;

    if (packageName === "tailwindcss") {
      version = TAILWIND_VERSION;
    } else if (!hasVersionSpecifier(info.specifier)) {
      warnUnversionedImport(info.specifier, packageName, ctx.projectId);
    }

    const url = buildEsmShUrl(packageName, version, subpath, {
      external: ["react", "react-dom"],
    });

    return { specifier: url };
  }
}

export const bareStrategy = new BareStrategy();
