import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "notion-search-notion",
  description:
    "Search for pages and databases in the connected Notion workspace. Returns matching pages with their titles and IDs.",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v.string().describe("Search query to find pages or databases"),
      type: v
        .enum(["page", "database", "all"])
        .default("all")
        .describe("Type of objects to search for"),
      limit: v
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Maximum number of results to return"),
    })
  )(),
  async execute({ query, type, limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const filter = type === "all" ? undefined : {
      property: "object" as const,
      value: requireAllowedValue(type, ["page", "database"], "object type"),
    };
    const results = await client.searchNotion(query, {
      filter,
      pageSize: limit,
    });

    return results.map((item) => {
      if (item.object === "page") {
        return {
          id: item.id,
          type: "page",
          title: client.getPageTitle(item),
          url: item.url,
          lastEdited: item.last_edited_time,
        };
      }

      return {
        id: item.id,
        type: "database",
        title: item.title?.map((t) => t.plain_text).join("") ?? "",
        url: item.url,
      };
    });
  },
});
