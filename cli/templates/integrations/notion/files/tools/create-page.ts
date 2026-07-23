import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "create-page",
  description:
    "Create a new page in Notion. Can create as a subpage of an existing page or as a new entry in a database.",
  inputSchema: defineSchema((v) =>
    v.object({
      parentId: v.string().describe("The ID of the parent page or database"),
      parentType: v.enum(["page", "database"]).describe(
        "Whether the parent is a page or database",
      ),
      title: v.string().describe("Title of the new page"),
      content: v
        .string()
        .optional()
        .describe(
          "Initial content for the page (plain text, paragraphs separated by double newlines)",
        ),
    })
  )(),
  async execute({ parentId, parentType, title, content }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const page = await client.createPage({
      parentId,
      parentType: requireAllowedValue(
        parentType,
        ["page", "database"],
        "parent type",
      ),
      title,
      content,
    });

    return {
      id: page.id,
      title: client.getPageTitle(page),
      url: page.url,
      createdAt: page.created_time,
    };
  },
});
