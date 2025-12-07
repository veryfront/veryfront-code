import { tool } from "veryfront/ai";
import { z } from "zod";
import { createFolder } from "../../lib/box-client.ts";

export default tool({
  id: "create-folder",
  description: "Create a new folder in Box. Use '0' as parent folder ID to create in the root folder.",
  inputSchema: z.object({
    parentFolderId: z.string().describe("The ID of the parent folder (use '0' for root folder)"),
    name: z.string().describe("The name of the folder to create"),
  }),
  async execute({ parentFolderId, name }) {
    const folder = await createFolder({
      parentFolderId,
      name,
    });

    return {
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
        createdAt: folder.created_at,
        path: folder.path_collection?.entries.map((e) => e.name).join("/") || "/",
      },
    };
  },
});
