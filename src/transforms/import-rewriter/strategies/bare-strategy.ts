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

    return true;
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (ctx.target === "ssr") return { specifier: null };

    const parsed = parseBarePackageSpecifier(info.specifier);
    if (parsed == null) {
      return { specifier: null };
    }

    let packageName = parsed.packageName;
    let version = parsed.version ?? undefined;
    const subpath = parsed.subpath ?? undefined;

    if (packageName === "tailwindcss") {
      version = TAILWIND_VERSION;
    } else if (!hasVersionSpecifier(info.specifier)) {
      warnUnversionedImport(info.specifier, ctx.projectId);
    }

    const url = buildEsmShUrl(packageName, version, subpath, {
      external: ["react"],
    });

    return { specifier: url };
  }
}

export const bareStrategy = new BareStrategy();
