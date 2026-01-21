import type { RuntimeAdapter } from "#veryfront/platform/adapters/index.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { withTimeoutThrow, TimeoutError } from "#veryfront/rendering/utils/stream-utils.ts";

export class ServerDataFetcher {
  constructor(private adapter?: RuntimeAdapter) {}

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (!pageModule.getServerData || typeof pageModule.getServerData !== "function") {
      return { props: {} };
    }

    const pathname = context.url?.pathname || "unknown";

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
      if (error instanceof TimeoutError) {
        serverLogger.error(`[ServerDataFetcher] getServerData timed out after ${DATA_FETCH_TIMEOUT_MS}ms`, {
          pathname,
        });
      }
      this.logError("Error in getServerData:", error);
      throw error;
    }
  }

  private logError(message: string, error: unknown): void {
    const debugEnabled = this.adapter?.env.get("VERYFRONT_DEBUG");
    if (debugEnabled) {
      serverLogger.error(message, error);
    }
  }
}
