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
      this.logError("Error in getStaticPaths:", error);
      throw error;
    }
  }

  private logError(message: string, error: unknown): void {
    serverLogger.error(message, error);
  }
}
