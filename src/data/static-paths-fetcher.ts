import type { PageWithData, StaticPathsResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { parseStaticPathsResult } from "./result-validation.ts";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";

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
          const result = await withTimeoutThrow(
            Promise.resolve(getStaticPaths()),
            DATA_FETCH_TIMEOUT_MS,
            "getStaticPaths",
          );
          const finalResult = result == null
            ? { paths: [], fallback: false } satisfies StaticPathsResult
            : parseStaticPathsResult(result);

          span?.setAttribute("data.paths_count", finalResult.paths?.length ?? 0);
          span?.setAttribute("data.fallback", String(finalResult.fallback ?? false));

          return finalResult;
        } catch (error) {
          if (error instanceof TimeoutError) {
            serverLogger.error("DATA_FETCH_STATIC_PATHS_TIMEOUT getStaticPaths timed out", {
              timeoutMs: DATA_FETCH_TIMEOUT_MS,
            });
            throw error;
          }
          serverLogger.error("DATA_FETCH_STATIC_PATHS_ERROR getStaticPaths failed", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          throw error;
        }
      },
      { "data.fetch_method": "getStaticPaths" },
    );
  }
}
