/**
 * Cross-project import rewriting strategy.
 *
 * Priority: 4
 * Handles: myproject@1.0.0/@/path, myproject/@/path
 */

import { rendererLogger } from "#veryfront/utils";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildCrossProjectUrl } from "../url-builder.ts";
import {
  isCrossProjectImport,
  parseCrossProjectImport,
} from "#veryfront/transforms/shared/cross-project-import.ts";

const logger = rendererLogger.component("cross-project-import");

export { isCrossProjectImport, parseCrossProjectImport };

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

    logger.debug("Rewriting", {
      from: info.specifier,
      to: url,
    });

    return { specifier: url };
  }
}

export const crossProjectStrategy = new CrossProjectStrategy();
