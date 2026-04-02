import type { PageWithData, StaticPathsResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";

const EMPTY_STATIC_PATHS_RESULT: StaticPathsResult = { paths: [], fallback: false };

export class StaticPathsFetcher {
  fetch(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    const getStaticPaths = pageModule.getStaticPaths;
    if (typeof getStaticPaths !== "function") {
      return Promise.resolve(null);
    }

    return withSpan(
      SpanNames.DATA_FETCH_STATIC_PATHS,
      async (span?: Span) => {
        try {
          const result = await getStaticPaths();
          const finalResult = result ?? EMPTY_STATIC_PATHS_RESULT;

          span?.setAttribute("data.paths_count", finalResult.paths?.length ?? 0);
          span?.setAttribute("data.fallback", String(finalResult.fallback ?? false));

          return finalResult;
        } catch (error) {
          serverLogger.error("DATA_FETCH_STATIC_PATHS_ERROR getStaticPaths failed", {}, error);
          throw error;
        }
      },
      { "data.fetch_method": "getStaticPaths" },
    );
  }
}
