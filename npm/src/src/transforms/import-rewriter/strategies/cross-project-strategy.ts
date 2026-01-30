/**
 * Cross-project import rewriting strategy.
 *
 * Priority: 4
 * Handles: myproject@1.0.0/@/path, myproject/@/path
 */

import { rendererLogger as logger } from "../../../utils/index.js";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.js";
import { buildCrossProjectUrl } from "../url-builder.js";

const CROSS_PROJECT_VERSIONED_PATTERN = /^([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/@\/(.+)$/;
const CROSS_PROJECT_LATEST_PATTERN = /^([a-z0-9-]+)\/@\/(.+)$/;

export function isCrossProjectImport(specifier: string): boolean {
  return CROSS_PROJECT_VERSIONED_PATTERN.test(specifier) ||
    CROSS_PROJECT_LATEST_PATTERN.test(specifier);
}

export function parseCrossProjectImport(
  specifier: string,
): { projectSlug: string; version: string; path: string } | null {
  const versionedMatch = specifier.match(CROSS_PROJECT_VERSIONED_PATTERN);
  if (versionedMatch) {
    const [, projectSlug, version, path] = versionedMatch;
    return { projectSlug: projectSlug!, version: version!, path: path! };
  }

  const latestMatch = specifier.match(CROSS_PROJECT_LATEST_PATTERN);
  if (!latestMatch) return null;

  const [, projectSlug, path] = latestMatch;
  return { projectSlug: projectSlug!, version: "latest", path: path! };
}

export class CrossProjectStrategy implements ImportRewriteStrategy {
  readonly name = "cross-project";
  readonly priority = 4;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return isCrossProjectImport(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    // SSR: Skip cross-project rewriting
    if (ctx.target === "ssr") {
      return { specifier: null };
    }

    const parsed = parseCrossProjectImport(info.specifier);
    if (!parsed) {
      return { specifier: null };
    }

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
