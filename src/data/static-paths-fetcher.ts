import type { PageWithData, StaticPathsResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "npm:@opentelemetry/api@1.9.0";

export class StaticPathsFetcher {
  fetch(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    if (!pageModule.getStaticPaths || typeof pageModule.getStaticPaths !== "function") {
      return Promise.resolve(null);
    }

    // Capture the function reference to preserve type narrowing inside the span callback
    const getStaticPaths = pageModule.getStaticPaths;

    return withSpan(
      SpanNames.DATA_FETCH_STATIC_PATHS,
      async (span?: Span) => {
        try {
          const result = await getStaticPaths();
          // Handle null/undefined return gracefully
          const finalResult = result ?? { paths: [], fallback: false };
          span?.setAttribute("data.paths_count", finalResult.paths?.length ?? 0);
          span?.setAttribute("data.fallback", String(finalResult.fallback ?? false));
          return finalResult;
        } catch (error) {
          serverLogger.error("Error in getStaticPaths:", error);
          throw error;
        }
      },
      { "data.fetch_method": "getStaticPaths" },
    );
  }
}
