/**
 * Search ServiceNow Knowledge Base Tool
 */

import { z } from "zod";
import { defineTool } from "veryfront/ai";
import { getServiceNowClient } from "../../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "servicenow-search-knowledge",
  description: "Search the ServiceNow knowledge base for articles matching a query",
  inputSchema: z.object({
    query: z.string().describe("Search query for knowledge articles"),
    limit: z.number().optional().describe("Maximum number of articles to return (default: 10)"),
  }),
  async execute(input) {
    const connected = await isServiceNowConnected();
    if (!connected) {
      return {
        error: "ServiceNow not connected",
        action: "Please connect ServiceNow via /api/auth/servicenow",
      };
    }

    try {
      const client = getServiceNowClient();
      const articles = await client.searchKnowledge(input.query, input.limit || 10);

      return {
        count: articles.length,
        articles: articles.map((article) => ({
          number: article.number,
          title: article.short_description,
          category: article.kb_category,
          published: article.published,
          sys_id: article.sys_id,
          // Truncate text for summary
          summary: article.text?.substring(0, 500) + (article.text?.length > 500 ? "..." : ""),
        })),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to search knowledge base",
      };
    }
  },
});
