import { serverLogger } from "../utils/index.js";
import { DATA_FETCH_TIMEOUT_MS } from "../config/defaults.js";
import { TimeoutError, withTimeoutThrow } from "../rendering/utils/stream-utils.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
export class ServerDataFetcher {
    adapter;
    constructor(adapter) {
        this.adapter = adapter;
    }
    fetch(pageModule, context) {
        if (typeof pageModule.getServerData !== "function") {
            return Promise.resolve({ props: {} });
        }
        const pathname = context.url?.pathname ?? "unknown";
        return withSpan("data.fetch_server", async () => {
            const start = performance.now();
            try {
                const result = await withTimeoutThrow(Promise.resolve(pageModule.getServerData(context)), DATA_FETCH_TIMEOUT_MS, `getServerData for ${pathname}`);
                if (result.redirect)
                    return { redirect: result.redirect };
                if (result.notFound)
                    return { notFound: true };
                return {
                    props: result.props ?? {},
                    revalidate: result.revalidate,
                };
            }
            catch (error) {
                const durationMs = Math.round(performance.now() - start);
                if (error instanceof TimeoutError) {
                    serverLogger.error("DATA_FETCH_TIMEOUT getServerData timed out", {
                        pathname,
                        durationMs,
                        timeoutMs: DATA_FETCH_TIMEOUT_MS,
                    });
                }
                else {
                    this.logError("DATA_FETCH_ERROR getServerData failed", error, { pathname, durationMs });
                }
                throw error;
            }
        }, {
            "data.fetch_method": "getServerData",
            "data.pathname": pathname,
            "data.timeout_ms": DATA_FETCH_TIMEOUT_MS,
        });
    }
    logError(message, error, context) {
        if (!this.adapter?.env.get("VERYFRONT_DEBUG"))
            return;
        serverLogger.error(message, context ?? {}, error);
    }
}
