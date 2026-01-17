import { tool } from "veryfront/tool";
import { z } from "zod";
import { downloadFile, formatFileSize } from "../../lib/onedrive-client.ts";

export default tool({
  id: "download-file",
  description: "Download file content from OneDrive. Returns the file content and metadata.",
  inputSchema: z.object({
    itemId: z.string().describe("The ID of the file to download"),
    preview: z.boolean().default(false).describe(
      "If true, return only first 1000 characters as preview",
    ),
  }),
  async execute({ itemId, preview }) {
    const { content, metadata } = await downloadFile(itemId);

    const displayContent = preview ? content.substring(0, 1000) : content;
    const isTruncated = preview && content.length > 1000;

    return {
      content: displayContent,
      isTruncated,
      metadata: {
        id: metadata.id,
        name: metadata.name,
        size: metadata.size,
        sizeFormatted: formatFileSize(metadata.size),
        mimeType: metadata.mimeType,
        createdDateTime: metadata.createdDateTime,
        lastModifiedDateTime: metadata.lastModifiedDateTime,
        webUrl: metadata.webUrl,
      },
      message: isTruncated
        ? `Retrieved preview (first 1000 characters) of ${metadata.name}`
        : `Retrieved full content of ${metadata.name}`,
    };
  },
});
