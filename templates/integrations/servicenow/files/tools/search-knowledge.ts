import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getServiceNowClient } from "../lib/servicenow-client.ts";

export default tool({
  id: "servicenow-search-knowledge",
  description: "Search the ServiceNow knowledge base for articles matching a query",
  inputSchema: defineSchema((v) => v.object({
    query: v.string().describe("Search query for knowledge articles"),
    limit: v.number().optional().describe("Maximum number of articles to return (default: 10)"),
  }))(),
  async execute(input) {
    try {
      const client = getServiceNowClient();
      const articles = await client.searchKnowledge(input.query, input.limit ?? 10);

      return {
        count: articles.length,
        articles: articles.map((article) => {
          const text = article.text ?? "";
          const summary = `${text.substring(0, 500)}${text.length > 500 ? "..." : ""}`;

          return {
            number: article.number,
            title: article.short_description,
            category: article.kb_category,
            published: article.published,
            sys_id: article.sys_id,
            summary,
          };
        }),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to search knowledge base",
      };
    }
  },
});
