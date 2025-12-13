import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

export class ServerDataFetcher {

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (!pageModule.getServerData) {
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
      // Always log errors for server data fetching failures
      // These are critical runtime errors that should be visible
      serverLogger.error("Error in getServerData:", error);
      throw error;
    }
  }
}
