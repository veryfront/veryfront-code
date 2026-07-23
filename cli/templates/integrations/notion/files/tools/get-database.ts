import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "get-database",
  description: "Get Notion database metadata, title, and property schema.",
  inputSchema: defineSchema((v) =>
    v.object({
      databaseId: v.string().describe(
        "The ID of the Notion database to retrieve",
      ),
    })
  )(),
  async execute({ databaseId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const database = await client.getDatabase(databaseId);

    return {
      id: database.id,
      title: database.title?.map((item) => item.plain_text).join("") ?? "",
      properties: database.properties,
    };
  },
});
