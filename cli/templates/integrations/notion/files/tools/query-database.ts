import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getPageTitle, queryDatabase } from "../../lib/notion-client.ts";

export default tool({
  id: "query-database",
  description: "Query a Notion database to retrieve entries. Supports filtering and sorting.",
  inputSchema: defineSchema((v) => v.object({
    databaseId: v.string().describe("The ID of the Notion database to query"),
    sortProperty: v.string().optional().describe("Property name to sort by"),
    sortDirection: v
      .enum(["ascending", "descending"])
      .default("descending")
      .describe("Sort direction"),
    limit: v.number().min(1).max(50).default(20).describe("Maximum number of results"),
  }))(),
  async execute({ databaseId, sortProperty, sortDirection, limit }) {
    const results = await queryDatabase(databaseId, {
      sorts: sortProperty ? [{ property: sortProperty, direction: sortDirection }] : undefined,
      pageSize: limit,
    });

    return results.map((page) => {
      const properties: Record<string, string> = {};

      for (const [key, prop] of Object.entries(page.properties)) {
        if (prop.type !== "title" && prop.type !== "rich_text") continue;

        const text =
          prop.type === "title"
            ? prop.title?.map((t) => t.plain_text).join("") ?? ""
            : prop.rich_text?.map((t) => t.plain_text).join("") ?? "";

        properties[key] = text;
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
