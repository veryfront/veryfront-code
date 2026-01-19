import type { PageWithData, StaticPathsResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";

export class StaticPathsFetcher {
  async fetch(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    if (!pageModule.getStaticPaths || typeof pageModule.getStaticPaths !== "function") {
      return null;
    }

    try {
      const result = await pageModule.getStaticPaths();
      // Handle null/undefined return gracefully
      return result ?? { paths: [], fallback: false };
    } catch (error) {
      serverLogger.error("Error in getStaticPaths:", error);
      throw error;
    }
  }
}
