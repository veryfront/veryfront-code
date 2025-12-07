import { tool } from "veryfront/ai";
import { z } from "zod";
import {
  extractPlainText,
  getPage,
  getPageContent,
  getPageTitle,
} from "../../lib/notion-client.ts";

export default tool({
  id: "read-page",
  description: "Read the content of a Notion page. Returns the page title and text content.",
  inputSchema: z.object({
    pageId: z.string().describe("The ID of the Notion page to read"),
  }),
  async execute({ pageId }) {
    const [page, blocks] = await Promise.all([
      getPage(pageId),
      getPageContent(pageId),
    ]);

    const title = getPageTitle(page);
    const content = extractPlainText(blocks);

    return {
      id: page.id,
      title,
      url: page.url,
      content,
      lastEdited: page.last_edited_time,
      createdAt: page.created_time,
    };
  },
});
