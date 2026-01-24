import { tool } from "veryfront/tool";
import { z } from "zod";
import { listItems } from "../../lib/monday-client.ts";

export default tool({
  id: "list-items",
  description: "List items from a Monday.com board. Items are the rows in a board.",
  inputSchema: z.object({
    boardId: z.string().describe("The ID of the board to list items from"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of items to return"),
    page: z.number().min(1).default(1).describe("Page number for pagination"),
  }),
  async execute({ boardId, limit, page }) {
    const items = await listItems({ boardId, limit, page });

    return items.map((item) => ({
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
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  },
});
