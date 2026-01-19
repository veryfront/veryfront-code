import type { RuntimeAdapter } from "#veryfront/platform/adapters/index.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";

export class ServerDataFetcher {
  constructor(private adapter?: RuntimeAdapter) {}

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (!pageModule.getServerData || typeof pageModule.getServerData !== "function") {
      return { props: {} };
    }

    try {
      const result = await pageModule.getServerData(context);

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
