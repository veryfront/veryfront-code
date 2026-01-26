import { serverLogger } from "../utils/index.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
export class StaticPathsFetcher {
    fetch(pageModule) {
        const getStaticPaths = pageModule.getStaticPaths;
        if (typeof getStaticPaths !== "function") {
            return Promise.resolve(null);
        }
        return withSpan(SpanNames.DATA_FETCH_STATIC_PATHS, async (span) => {
            try {
                const result = await getStaticPaths();
                const finalResult = result ?? { paths: [], fallback: false };
                span?.setAttribute("data.paths_count", finalResult.paths?.length ?? 0);
                span?.setAttribute("data.fallback", String(finalResult.fallback ?? false));
                return finalResult;
            }
            catch (error) {
                serverLogger.error("Error in getStaticPaths:", error);
                throw error;
            }
        }, { "data.fetch_method": "getStaticPaths" });
    }
}
