import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createConfluenceClient } from "../lib/confluence-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "confluence-create-page",
  description:
    "Create a new page in a Confluence space. Can optionally be created as a child of an existing page.",
  inputSchema: defineSchema((v) =>
    v.object({
      spaceKey: v
        .string()
        .describe(
          'The key of the space to create the page in (e.g., "TEAM", "DEV")',
        ),
      title: v.string().describe("Title of the new page"),
      content: v
        .string()
        .describe(
          "Content for the page (can be plain text or Confluence storage format HTML)",
        ),
      parentId: v
        .string()
        .optional()
        .describe(
          "Optional ID of the parent page to create this as a child page",
        ),
      type: v
        .enum(["page", "blogpost"])
        .default("page")
        .describe("Type of content to create"),
    })
  )(),
  async execute({ spaceKey, title, content, parentId, type }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createConfluenceClient(userId);
    const trimmedContent = content.trim();
    const storageContent = trimmedContent.startsWith("<")
      ? trimmedContent
      : client.formatAsStorage(trimmedContent);

    const page = await client.createPage({
      spaceKey,
      title,
      content: storageContent,
      parentId,
      type: requireAllowedValue(type, ["page", "blogpost"], "content type"),
    });

    return {
      id: page.id,
      title: page.title,
      type: page.type ?? "page",
      url: page._links.webui,
      version: page.version.number,
      spaceId: page.spaceId,
    };
  },
});
