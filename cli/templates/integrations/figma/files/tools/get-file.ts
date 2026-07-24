import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createFigmaClient } from "../lib/figma-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "figma-get-file",
  description:
    "Get detailed information about a Figma file including components, styles, and structure. Returns file metadata, component list, and style information.",
  inputSchema: defineSchema((v) =>
    v.object({
      fileKey: v.string().describe("The file key (from the Figma URL)"),
      includeComponents: v
        .boolean()
        .default(true)
        .describe("Include component information"),
      includeStyles: v.boolean().default(true).describe(
        "Include style information",
      ),
      depth: v
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Depth of nodes to traverse (default: all)"),
    })
  )(),
  async execute({ fileKey, includeComponents, includeStyles, depth }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createFigmaClient(userId);
    const file = await client.getFile(fileKey, { depth });

    return {
      summary: client.getFileSummary(file),
      url: `https://www.figma.com/file/${fileKey}`,
      thumbnailUrl: file.thumbnailUrl,
      pages: file.document.children?.map((page) => ({
        id: page.id,
        name: page.name,
        type: page.type,
      })) ?? [],
      ...(includeComponents
        ? { components: client.extractComponents(file) }
        : {}),
      ...(includeStyles ? { styles: client.extractStyles(file) } : {}),
    };
  },
});
