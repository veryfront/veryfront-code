import { tool } from "veryfront/tool";
import { z } from "zod";
import { createItem } from "../../lib/monday-client.ts";

export default tool({
  id: "create-item",
  description: "Create a new item in a Monday.com board. Items are the rows in a board.",
  inputSchema: z.object({
    boardId: z.string().describe("The ID of the board to create the item in"),
    itemName: z.string().describe("The name/title of the item"),
    groupId: z.string().optional().describe("Optional group ID within the board to add the item to"),
    columnValues: z.record(z.unknown()).optional().describe(
      "Optional column values as a key-value object. Keys are column IDs, values depend on column type.",
    ),
  }),
  async execute({ boardId, itemName, groupId, columnValues }) {
    const item = await createItem({
      boardId,
      itemName,
      groupId,
      columnValues,
    });

    return {
      success: true,
      item: {
        id: item.id,
        name: item.name,
        state: item.state,
        board: item.board,
        group: item.group,
        createdAt: item.created_at,
      },
    };
  },
});
