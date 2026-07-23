import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOneDriveClient } from "../lib/onedrive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "download-file",
  description:
    "Download file content from OneDrive. Returns the file content and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      itemId: v.string().describe("The ID of the file to download"),
      preview: v
        .boolean()
        .default(false)
        .describe("If true, return only first 1000 characters as preview"),
    })
  )(),
  async execute({ itemId, preview }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOneDriveClient(userId);
    const { content, metadata } = await client.downloadFile(itemId);

    const shouldTruncate = preview && content.length > 1000;

    return {
      content: preview ? content.substring(0, 1000) : content,
      isTruncated: shouldTruncate,
      metadata: {
        id: metadata.id,
        name: metadata.name,
        size: metadata.size,
        sizeFormatted: client.formatFileSize(metadata.size),
        mimeType: metadata.mimeType,
        createdDateTime: metadata.createdDateTime,
        lastModifiedDateTime: metadata.lastModifiedDateTime,
        webUrl: metadata.webUrl,
      },
      message: shouldTruncate
        ? `Retrieved preview (first 1000 characters) of ${metadata.name}`
        : `Retrieved full content of ${metadata.name}`,
    };
  },
});
