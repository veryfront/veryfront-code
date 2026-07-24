import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "notion-get-page",
  description:
    "Get Notion page metadata and properties without reading child block content.",
  inputSchema: defineSchema((v) =>
    v.object({
      pageId: v.string().describe("The ID of the Notion page to retrieve"),
    })
  )(),
  async execute({ pageId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const page = await client.getPage(pageId);

    return {
      id: page.id,
      title: client.getPageTitle(page),
      url: page.url,
      parent: page.parent,
      properties: page.properties,
      lastEdited: page.last_edited_time,
      createdAt: page.created_time,
    };
  },
});
