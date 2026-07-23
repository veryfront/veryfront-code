import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDriveClient } from "../lib/drive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "create-folder",
  description:
    "Create a new folder in Google Drive. Can optionally specify a parent folder. Returns the new folder ID and details.",
  inputSchema: defineSchema((v) =>
    v.object({
      name: v.string().describe("Name of the folder to create"),
      parentId: v
        .string()
        .optional()
        .describe("ID of the parent folder. If not provided, creates in root."),
      description: v
        .string()
        .optional()
        .describe("Optional description for the folder"),
    })
  )(),
  async execute({ name, parentId, description }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDriveClient(userId);
    const folder = await client.createFolder({ name, parentId, description });

    return {
      id: folder.id,
      name: folder.name,
      mimeType: folder.mimeType,
      createdTime: folder.createdTime,
      modifiedTime: folder.modifiedTime,
      webViewLink: folder.webViewLink,
      parents: folder.parents,
    };
  },
});
