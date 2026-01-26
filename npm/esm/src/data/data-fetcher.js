import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
import { CacheManager } from "./data-fetching-cache.js";
import { ServerDataFetcher } from "./server-data-fetcher.js";
import { StaticDataFetcher } from "./static-data-fetcher.js";
import { StaticPathsFetcher } from "./static-paths-fetcher.js";
export class DataFetcher {
    cacheManager;
    serverFetcher;
    staticFetcher;
    pathsFetcher;
    constructor(adapter) {
        this.cacheManager = new CacheManager();
        this.serverFetcher = new ServerDataFetcher(adapter);
        this.staticFetcher = new StaticDataFetcher(this.cacheManager, adapter);
        this.pathsFetcher = new StaticPathsFetcher();
    }
    fetchData(pageModule, context, mode = "development") {
        const preferServerData = mode === "development" || !pageModule.getStaticData;
        let fetchType = "none";
        if (preferServerData && pageModule.getServerData) {
            fetchType = "server";
        }
        else if (pageModule.getStaticData) {
            fetchType = "static";
        }
        return withSpan(SpanNames.DATA_FETCH, async () => {
            if (preferServerData && pageModule.getServerData) {
                return await this.serverFetcher.fetch(pageModule, context);
            }
            if (pageModule.getStaticData) {
                return await this.staticFetcher.fetch(pageModule, context);
            }
            return { props: {} };
        }, {
            "data.fetch_type": fetchType,
            "data.mode": mode,
            "data.pathname": context.url?.pathname ?? "unknown",
        });
    }
    getStaticPaths(pageModule) {
        return this.pathsFetcher.fetch(pageModule);
    }
    clearCache(pattern) {
        if (!pattern) {
            this.cacheManager.clear();
            return;
        }
        this.cacheManager.clearPattern(pattern);
    }
}
