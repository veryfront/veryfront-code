/**
 * Cross-project import rewriting strategy.
 *
 * Priority: 4
 * Handles: myproject@1.0.0/@/path, myproject/@/path
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildCrossProjectUrl } from "../url-builder.ts";

const CROSS_PROJECT_VERSIONED_PATTERN = /^([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/@\/(.+)$/;
const CROSS_PROJECT_LATEST_PATTERN = /^([a-z0-9-]+)\/@\/(.+)$/;

export function isCrossProjectImport(specifier: string): boolean {
  return (
    CROSS_PROJECT_VERSIONED_PATTERN.test(specifier) ||
    CROSS_PROJECT_LATEST_PATTERN.test(specifier)
  );
}

export function parseCrossProjectImport(
  specifier: string,
): { projectSlug: string; version: string; path: string } | null {
  const versionedMatch = specifier.match(CROSS_PROJECT_VERSIONED_PATTERN);
  if (versionedMatch && versionedMatch[1] && versionedMatch[2] && versionedMatch[3]) {
    return { projectSlug: versionedMatch[1], version: versionedMatch[2], path: versionedMatch[3] };
  }

  const latestMatch = specifier.match(CROSS_PROJECT_LATEST_PATTERN);
  if (!latestMatch || !latestMatch[1] || !latestMatch[2]) return null;

  return { projectSlug: latestMatch[1], version: "latest", path: latestMatch[2] };
}

export class CrossProjectStrategy implements ImportRewriteStrategy {
  readonly name = "cross-project";
  readonly priority = 4;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return isCrossProjectImport(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (ctx.target === "ssr") return { specifier: null };

    const parsed = parseCrossProjectImport(info.specifier);
    if (!parsed) return { specifier: null };

    const url = buildCrossProjectUrl(
      parsed.projectSlug,
      parsed.version === "latest" ? null : parsed.version,
      parsed.path,
    );

    logger.debug("[CrossProjectImport] Rewriting", {
      from: info.specifier,
      to: url,
    });

    return { specifier: url };
  }
}

export const crossProjectStrategy = new CrossProjectStrategy();
