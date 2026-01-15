import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  description: "Search the web using DuckDuckGo and return results",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    maxResults: z.number().optional().default(5).describe("Maximum number of results to return"),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    try {
      // Use DuckDuckGo HTML search (no API key needed)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Veryfront/1.0; Research Assistant)",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Search failed: HTTP ${response.status}`,
          query,
        };
      }

      const html = await response.text();

      // Parse results from HTML (simple regex extraction)
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      // Match result blocks
      const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*)<\/a>/gi;

      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        const [, url, title, snippet] = match;
        if (url && title) {
          results.push({
            title: title.trim(),
            url: url.startsWith("//") ? `https:${url}` : url,
            snippet: snippet?.trim() || "",
          });
        }
      }

      // Fallback: simpler parsing if regex didn't match
      if (results.length === 0) {
        const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi;
        while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
          const [, url, title] = match;
          if (url && title && !url.includes("duckduckgo.com")) {
            results.push({
              title: title.trim(),
              url,
              snippet: "",
            });
          }
        }
      }

      return {
        success: true,
        query,
        resultCount: results.length,
        results,
        searchedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        query,
      };
    }
  },
});
