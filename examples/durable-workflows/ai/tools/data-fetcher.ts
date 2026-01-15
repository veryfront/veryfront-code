import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  description: "Fetch content from a URL (webpage, API, etc.)",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch data from"),
  }),
  execute: async ({ url }) => {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Veryfront/1.0 (Research Assistant)",
          "Accept": "text/html,application/json,text/plain,*/*",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          url,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let content: unknown;

      if (contentType.includes("application/json")) {
        content = await response.json();
      } else {
        const text = await response.text();
        // Truncate very long responses
        content = text.length > 10000 ? text.slice(0, 10000) + "\n...(truncated)" : text;
      }

      return {
        success: true,
        url,
        contentType,
        content,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        url,
      };
    }
  },
});
