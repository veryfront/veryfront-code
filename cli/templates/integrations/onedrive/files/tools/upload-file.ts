import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOneDriveClient } from "../lib/onedrive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "onedrive-upload-file",
  description:
    "Upload or update a file in OneDrive. Can create new files or overwrite existing ones.",
  inputSchema: defineSchema((v) =>
    v.object({
      fileName: v
        .string()
        .describe(
          "Name of the file to upload (e.g., 'notes.txt', 'document.pdf')",
        ),
      content: v.string().describe("The content to write to the file"),
      parentFolderId: v
        .string()
        .default("root")
        .describe(
          'Parent folder ID where the file should be uploaded (default: "root")',
        ),
    })
  )(),
  async execute({ fileName, content, parentFolderId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOneDriveClient(userId);
    const name = fileName.trim();

    if (!name) throw new Error("Filename cannot be empty");
    if (name.includes("/") || name.includes("\\")) {
      throw new Error("Filename cannot contain path separators");
    }

    const result = await client.uploadFile(name, content, parentFolderId);
    const size = result.size ?? 0;

    return {
      success: true,
      id: result.id,
      name: result.name,
      webUrl: result.webUrl,
      size,
      sizeFormatted: client.formatFileSize(size),
      createdDateTime: result.createdDateTime,
      lastModifiedDateTime: result.lastModifiedDateTime,
      message: `File uploaded successfully: ${result.name}`,
    };
  },
});
