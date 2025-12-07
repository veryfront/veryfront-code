import { tool } from "veryfront/ai";
import { z } from "zod";
import {
  extractComponents,
  extractStyles,
  getFile,
  getFileSummary,
} from "../../lib/figma-client.ts";

export default tool({
  id: "get-file",
  description:
    "Get detailed information about a Figma file including components, styles, and structure. Returns file metadata, component list, and style information.",
  inputSchema: z.object({
    fileKey: z.string().describe("The file key (from the Figma URL)"),
    includeComponents: z.boolean().default(true).describe("Include component information"),
    includeStyles: z.boolean().default(true).describe("Include style information"),
    depth: z.number().min(1).max(10).optional().describe(
      "Depth of nodes to traverse (default: all)",
    ),
  }),
  async execute({ fileKey, includeComponents, includeStyles, depth }) {
    const file = await getFile(fileKey, { depth });
    const summary = getFileSummary(file);

    const result: {
      summary: typeof summary;
      url: string;
      thumbnailUrl: string;
      components?: ReturnType<typeof extractComponents>;
      styles?: ReturnType<typeof extractStyles>;
      pages: Array<{ id: string; name: string; type: string }>;
    } = {
      summary,
      url: `https://www.figma.com/file/${fileKey}`,
      thumbnailUrl: file.thumbnailUrl,
      pages: (file.document.children || []).map((page) => ({
        id: page.id,
        name: page.name,
        type: page.type,
      })),
    };

    if (includeComponents) {
      result.components = extractComponents(file);
    }

    if (includeStyles) {
      result.styles = extractStyles(file);
    }

    return result;
  },
});
