// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";

export class ServerDataFetcher {
  constructor(private adapter?: RuntimeAdapter) {}

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (!pageModule.getServerData || typeof pageModule.getServerData !== "function") {
      return { props: {} };
    }

    const pathname = context.url?.pathname || "unknown";
    const start = performance.now();

    try {
      const result = await withTimeoutThrow(
        Promise.resolve(pageModule.getServerData(context)),
        DATA_FETCH_TIMEOUT_MS,
        `getServerData for ${pathname}`,
      );

      if (result.redirect) {
        return { redirect: result.redirect };
      }

      if (result.notFound) {
        return { notFound: true };
      }

      return {
        props: result.props ?? {},
        revalidate: result.revalidate,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getServerData timed out", {
          pathname,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
        });
      } else {
        this.logError("DATA_FETCH_ERROR getServerData failed", error, { pathname, durationMs });
      }
      throw error;
    }
  }

  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    const debugEnabled = this.adapter?.env.get("VERYFRONT_DEBUG");
    if (debugEnabled) {
      serverLogger.error(message, context ?? {}, error);
    }
  }
}
