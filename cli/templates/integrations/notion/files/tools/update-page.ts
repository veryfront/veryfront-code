import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "update-page",
  description: "Update Notion page properties or archive/unarchive a page.",
  inputSchema: defineSchema((v) =>
    v.object({
      pageId: v.string().describe("The ID of the Notion page to update"),
      properties: v.record(v.string(), v.unknown()).optional().describe(
        "Page properties to update",
      ),
      archived: v.boolean().optional().describe(
        "Whether the page should be archived",
      ),
      icon: v.record(v.string(), v.unknown()).optional().describe(
        "Optional page icon object",
      ),
      cover: v.record(v.string(), v.unknown()).optional().describe(
        "Optional page cover object",
      ),
    })
  )(),
  async execute({ pageId, properties, archived, icon, cover }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const page = await client.updatePage({
      pageId,
      properties,
      archived,
      icon,
      cover,
    });

    return {
      id: page.id,
      title: client.getPageTitle(page),
      url: page.url,
      properties: page.properties,
      archived,
      lastEdited: page.last_edited_time,
    };
  },
});
