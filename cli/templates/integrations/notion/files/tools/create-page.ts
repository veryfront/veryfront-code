import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createPage, getPageTitle } from "../../lib/notion-client.ts";

export default tool({
  id: "create-page",
  description:
    "Create a new page in Notion. Can create as a subpage of an existing page or as a new entry in a database.",
  inputSchema: defineSchema((v) => v.object({
    parentId: v.string().describe("The ID of the parent page or database"),
    parentType: v.enum(["page", "database"]).describe("Whether the parent is a page or database"),
    title: v.string().describe("Title of the new page"),
    content: v
      .string()
      .optional()
      .describe(
        "Initial content for the page (plain text, paragraphs separated by double newlines)",
      ),
  }))(),
  async execute({ parentId, parentType, title, content }) {
    const page = await createPage({ parentId, parentType, title, content });

    return {
      id: page.id,
      title: getPageTitle(page),
      url: page.url,
      createdAt: page.created_time,
    };
  },
});
