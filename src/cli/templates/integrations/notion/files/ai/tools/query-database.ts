import { tool } from "veryfront/ai";
import { z } from "zod";
import { getPageTitle, queryDatabase } from "../../lib/notion-client.ts";

export default tool({
  id: "query-database",
  description: "Query a Notion database to retrieve entries. Supports filtering and sorting.",
  inputSchema: z.object({
    databaseId: z.string().describe("The ID of the Notion database to query"),
    sortProperty: z.string().optional().describe("Property name to sort by"),
    sortDirection: z.enum(["ascending", "descending"]).default("descending").describe(
      "Sort direction",
    ),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of results"),
  }),
  async execute({ databaseId, sortProperty, sortDirection, limit }) {
    const sorts = sortProperty ? [{ property: sortProperty, direction: sortDirection }] : undefined;

    const results = await queryDatabase(databaseId, {
      sorts,
      pageSize: limit,
    });

    return results.map((page) => {
      const properties: Record<string, string> = {};
      for (const [key, prop] of Object.entries(page.properties)) {
        if (prop.type === "title" && prop.title) {
          properties[key] = prop.title.map((t) => t.plain_text).join("");
        } else if (prop.type === "rich_text" && prop.rich_text) {
          properties[key] = prop.rich_text.map((t) => t.plain_text).join("");
        }
      }

      return {
        id: page.id,
        title: getPageTitle(page),
        url: page.url,
        properties,
        lastEdited: page.last_edited_time,
      };
    });
  },
});
