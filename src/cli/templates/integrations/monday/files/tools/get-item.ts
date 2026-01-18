import { tool } from "veryfront/tool";
import { z } from "zod";
import { getItem } from "../../lib/monday-client.ts";

export default tool({
  id: "get-item",
  description: "Get details of a specific Monday.com item by its ID.",
  inputSchema: z.object({
    itemId: z.string().describe("The ID of the item to retrieve"),
  }),
  async execute({ itemId }) {
    const item = await getItem(itemId);

    return {
      id: item.id,
      name: item.name,
      state: item.state,
      board: item.board,
      group: item.group,
      columnValues: item.column_values?.map((col) => ({
        id: col.id,
        title: col.title,
        text: col.text,
        type: col.type,
        value: col.value,
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  },
});
