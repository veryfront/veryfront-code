import { tool } from "veryfront/ai";
import { z } from "zod";
import { createPage, formatAsStorage } from "../../lib/confluence-client.ts";

export default tool({
  id: "create-page",
  description:
    "Create a new page in a Confluence space. Can optionally be created as a child of an existing page.",
  inputSchema: z.object({
    spaceKey: z.string().describe(
      'The key of the space to create the page in (e.g., "TEAM", "DEV")',
    ),
    title: z.string().describe("Title of the new page"),
    content: z.string().describe(
      "Content for the page (can be plain text or Confluence storage format HTML)",
    ),
    parentId: z.string().optional().describe(
      "Optional ID of the parent page to create this as a child page",
    ),
    type: z.enum(["page", "blogpost"]).default("page").describe("Type of content to create"),
  }),
  async execute({ spaceKey, title, content, parentId, type }) {
    // Check if content looks like HTML, otherwise format as storage
    const storageContent = content.trim().startsWith("<") ? content : formatAsStorage(content);

    const page = await createPage({
      spaceKey,
      title,
      content: storageContent,
      parentId,
      type,
    });

    return {
      id: page.id,
      title: page.title,
      type: page.type,
      url: page._links.webui,
      version: page.version.number,
      spaceId: page.spaceId,
    };
  },
});
