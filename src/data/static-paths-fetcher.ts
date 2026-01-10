import type { PageWithData, StaticPathsResult } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

export class StaticPathsFetcher {
  async fetch(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    if (!pageModule.getStaticPaths) {
      return null;
    }

    try {
      return await pageModule.getStaticPaths();
    } catch (error) {
      serverLogger.error("Error in getStaticPaths:", error);
      throw error;
    }
  }
}
