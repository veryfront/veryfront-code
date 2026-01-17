import { tool } from "veryfront/tool";
import { z } from "zod";
import { uploadFile } from "../../lib/box-client.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload a file to Box. Provide the file content as a string. Use '0' as parent folder ID to upload to the root folder.",
  inputSchema: z.object({
    parentFolderId: z.string().describe("The ID of the parent folder to upload to (use '0' for root folder)"),
    fileName: z.string().describe("The name of the file including extension (e.g., 'document.txt')"),
    fileContent: z.string().describe("The content of the file as a string"),
  }),
  async execute({ parentFolderId, fileName, fileContent }) {
    const file = await uploadFile({
      parentFolderId,
      fileName,
      fileContent,
    });

    return {
      success: true,
      file: {
        id: file.id,
        name: file.name,
        size: file.size,
        createdAt: file.created_at,
        path: file.path_collection?.entries.map((e) => e.name).join("/") || "/",
      },
    };
  },
});
