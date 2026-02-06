import { tool } from "veryfront/tool";
import { z } from "zod";
import { getFile } from "../../lib/box-client.ts";

export default tool({
  id: "get-file",
  description: "Get detailed information about a specific file or folder in Box.",
  inputSchema: z.object({
    itemId: z.string().describe("The ID of the file or folder"),
    itemType: z
      .enum(["file", "folder"])
      .default("file")
      .describe("Whether the item is a file or folder"),
  }),
  async execute({ itemId, itemType }) {
    const item = await getFile(itemId, itemType);
    const isFile = item.type === "file";
    const path = item.path_collection?.entries.map((e) => e.name).join("/") ?? "/";

    return {
      id: item.id,
      type: item.type,
      name: item.name,
      size: isFile ? item.size : undefined,
      description: item.description,
      createdAt: item.created_at,
      modifiedAt: item.modified_at,
      createdBy: item.created_by?.name,
      modifiedBy: item.modified_by?.name,
      path,
      sharedLink: isFile ? item.shared_link?.url : undefined,
    };
  },
});
