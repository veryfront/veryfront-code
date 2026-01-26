import { tool } from "veryfront/tool";
import { z } from "zod";
import { getPageTitle, searchNotion } from "../../lib/notion-client.ts";

export default tool({
  id: "search-notion",
  description:
    "Search for pages and databases in the connected Notion workspace. Returns matching pages with their titles and IDs.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find pages or databases"),
    type: z
      .enum(["page", "database", "all"])
      .default("all")
      .describe("Type of objects to search for"),
    limit: z
      .number()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of results to return"),
  }),
  async execute({ query, type, limit }) {
    const filter =
      type === "all" ? undefined : { property: "object", value: type };

    const results = await searchNotion(query, { filter, pageSize: limit });

    return results.map((item) => {
      if (item.object === "page") {
        return {
          id: item.id,
          type: "page",
          title: getPageTitle(item),
          url: item.url,
          lastEdited: item.last_edited_time,
        };
      }

      return {
        id: item.id,
        type: "database",
        title: item.title?.map((t: { plain_text: string }) => t.plain_text).join("") ?? "",
        url: item.url,
      };
    });
  },
});
