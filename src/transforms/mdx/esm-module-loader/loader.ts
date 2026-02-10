/**
 * ESM Module Loader
 *
 * Main public entry point for loading MDX modules as ESM.
 * Delegates to extracted modules for import transformation, helpers, and module writing.
 *
 * @module build/transforms/mdx/esm-module-loader/loader
 */

import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { MDXModule } from "../types.ts";
import type { ESMLoaderContext } from "./types.ts";
import { doLoadModuleESM } from "./module-writer.ts";

export async function loadModuleESM(
  compiledProgramCode: string,
  context: ESMLoaderContext,
): Promise<MDXModule> {
  const projectSlug = context.projectSlug || "unknown";

  return await withSpan(
    SpanNames.MDX_LOAD_MODULE_ESM,
    () => doLoadModuleESM(compiledProgramCode, context),
    {
      "mdx.project_slug": projectSlug,
      "mdx.code_length": compiledProgramCode.length,
    },
  );
}
