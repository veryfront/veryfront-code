import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatFileSize, uploadFile } from "../../lib/dropbox-client.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload or update a file in Dropbox. Can create new files or overwrite existing ones.",
  inputSchema: defineSchema((v) => v.object({
    path: v
      .string()
      .describe(
        'Full path where the file should be saved in Dropbox (e.g., "/Documents/notes.txt")',
      ),
    content: v.string().describe("The content to write to the file"),
    mode: v
      .enum(["add", "overwrite", "update"])
      .default("add")
      .describe(
        'Upload mode: "add" (fail if exists), "overwrite" (replace if exists), "update" (update specific revision)',
      ),
    autorename: v
      .boolean()
      .default(false)
      .describe("If true and file exists, automatically rename to avoid conflicts"),
  }))(),
  async execute({ path, content, mode, autorename }) {
    if (!path.startsWith("/")) {
      throw new Error('Path must start with "/" (e.g., "/Documents/file.txt")');
    }

    const result = await uploadFile(path, content, { mode, autorename, mute: false });
    const displayPath = result.path_display ?? result.path_lower ?? "";

    let message = `File updated successfully at ${result.path_display}`;
    if (mode === "add") {
      message = `File created successfully at ${result.path_display}`;
    }

    return {
      success: true,
      name: result.name,
      path: displayPath,
      id: result.id,
      size: result.size,
      sizeFormatted: formatFileSize(result.size),
      modified: result.server_modified,
      rev: result.rev,
      message,
    };
  },
});
