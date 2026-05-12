import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { extractPlainText, getPage, getPageContent, getPageTitle } from "../../lib/notion-client.ts";

export default tool({
  id: "read-page",
  description: "Read the content of a Notion page. Returns the page title and text content.",
  inputSchema: defineSchema((v) => v.object({
    pageId: v.string().describe("The ID of the Notion page to read"),
  }))(),
  async execute({ pageId }): Promise<{
    id: string;
    title: string;
    url: string;
    content: string;
    lastEdited: string;
    createdAt: string;
  }> {
    const [page, blocks] = await Promise.all([getPage(pageId), getPageContent(pageId)]);

    return {
      id: page.id,
      title: getPageTitle(page),
      url: page.url,
      content: extractPlainText(blocks),
      lastEdited: page.last_edited_time,
      createdAt: page.created_time,
    };
  },
});
