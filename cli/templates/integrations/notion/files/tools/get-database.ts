import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getDatabase } from "../../lib/notion-client.ts";

export default tool({
  id: "get-database",
  description: "Get Notion database metadata, title, and property schema.",
  inputSchema: defineSchema((v) => v.object({
    databaseId: v.string().describe("The ID of the Notion database to retrieve"),
  }))(),
  async execute({ databaseId }) {
    const database = await getDatabase(databaseId);

    return {
      id: database.id,
      title: database.title?.map((item) => item.plain_text).join("") ?? "",
      properties: database.properties,
    };
  },
});
