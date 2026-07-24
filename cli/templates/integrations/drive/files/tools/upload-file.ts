import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDriveClient } from "../lib/drive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "drive-upload-file",
  description:
    "Upload or create a text file in Google Drive. Supports plain text, JSON, CSV, Markdown, and other text formats. Returns the new file ID and details.",
  inputSchema: defineSchema((v) =>
    v.object({
      name: v
        .string()
        .describe(
          "Name of the file including extension (e.g., 'report.txt', 'data.json')",
        ),
      content: v.string().describe("Text content of the file"),
      mimeType: v
        .string()
        .default("text/plain")
        .describe(
          "MIME type of the file. Examples: 'text/plain', 'application/json', 'text/csv', 'text/markdown'",
        ),
      parentId: v
        .string()
        .optional()
        .describe("ID of the parent folder. If not provided, creates in root."),
      description: v.string().optional().describe(
        "Optional description for the file",
      ),
    })
  )(),
  async execute({ name, content, mimeType, parentId, description }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDriveClient(userId);
    const file = await client.uploadFile({
      name,
      content,
      mimeType,
      parentId,
      description,
    });

    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink,
    };
  },
});
