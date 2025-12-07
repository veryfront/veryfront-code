import { tool } from "veryfront/ai";
import { z } from "zod";
import { listFiles } from "../../lib/box-client.ts";

export default tool({
  id: "list-files",
  description:
    "List files and folders from a Box folder. Use folder ID '0' for the root folder.",
  inputSchema: z.object({
    folderId: z.string().default("0").describe("Folder ID to list files from (use '0' for root folder)"),
    limit: z.number().min(1).max(100).default(50).describe("Maximum number of items to return"),
    offset: z.number().min(0).default(0).describe("Number of items to skip for pagination"),
  }),
  async execute({ folderId, limit, offset }) {
    const items = await listFiles({
      folderId,
      limit,
      offset,
    });

    return items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      size: item.type === "file" ? item.size : undefined,
      createdAt: item.created_at,
      modifiedAt: item.modified_at,
      createdBy: item.created_by?.name,
      modifiedBy: item.modified_by?.name,
      path: item.path_collection?.entries.map((e) => e.name).join("/") || "/",
    }));
  },
});
