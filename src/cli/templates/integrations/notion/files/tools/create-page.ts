import { tool } from "veryfront/tool";
import { z } from "zod";
import { createPage, getPageTitle } from "../../lib/notion-client.ts";

export default tool({
  id: "create-page",
  description:
    "Create a new page in Notion. Can create as a subpage of an existing page or as a new entry in a database.",
  inputSchema: z.object({
    parentId: z.string().describe("The ID of the parent page or database"),
    parentType: z.enum(["page", "database"]).describe("Whether the parent is a page or database"),
    title: z.string().describe("Title of the new page"),
    content: z.string().optional().describe(
      "Initial content for the page (plain text, paragraphs separated by double newlines)",
    ),
  }),
  async execute({ parentId, parentType, title, content }) {
    const page = await createPage({
      parentId,
      parentType,
      title,
      content,
    });

    return {
      id: page.id,
      title: getPageTitle(page),
      url: page.url,
      createdAt: page.created_time,
    };
  },
});
