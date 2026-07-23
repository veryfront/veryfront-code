import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "read-page",
  description:
    "Read the content of a Notion page. Returns the page title and text content.",
  inputSchema: defineSchema((v) =>
    v.object({
      pageId: v.string().describe("The ID of the Notion page to read"),
    })
  )(),
  async execute({ pageId }, context): Promise<{
    id: string;
    title: string;
    url: string;
    content: string;
    lastEdited: string;
    createdAt: string;
  }> {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const [page, blocks] = await Promise.all([
      client.getPage(pageId),
      client.getPageContent(pageId),
    ]);

    return {
      id: page.id,
      title: client.getPageTitle(page),
      url: page.url,
      content: client.extractPlainText(blocks),
      lastEdited: page.last_edited_time,
      createdAt: page.created_time,
    };
  },
});
