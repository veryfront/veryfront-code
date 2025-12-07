import { tool } from "veryfront/ai";
import { z } from "zod";
import { searchFiles } from "../../lib/box-client.ts";

export default tool({
  id: "search-files",
  description:
    "Search for files and folders in Box by name or content. Returns matching items with their details.",
  inputSchema: z.object({
    query: z.string().describe("Search query string to find files and folders"),
    limit: z.number().min(1).max(100).default(50).describe("Maximum number of results to return"),
    offset: z.number().min(0).default(0).describe("Number of results to skip for pagination"),
    contentTypes: z.array(z.string()).optional().describe(
      "Filter by content types (e.g., ['name', 'description', 'file_content'])",
    ),
  }),
  async execute({ query, limit, offset, contentTypes }) {
    const results = await searchFiles({
      query,
      limit,
      offset,
      contentTypes,
    });

    return results.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      size: item.size,
      createdAt: item.created_at,
      modifiedAt: item.modified_at,
      path: item.path_collection?.entries.map((e) => e.name).join("/") || "/",
    }));
  },
});
