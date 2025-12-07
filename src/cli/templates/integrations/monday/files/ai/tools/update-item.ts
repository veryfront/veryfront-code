import { tool } from "veryfront/ai";
import { z } from "zod";
import { updateItem } from "../../lib/monday-client.ts";

export default tool({
  id: "update-item",
  description: "Update an existing Monday.com item. Can update the name and/or column values.",
  inputSchema: z.object({
    itemId: z.string().describe("The ID of the item to update"),
    name: z.string().optional().describe("New name/title for the item"),
    columnValues: z.record(z.unknown()).optional().describe(
      "Column values to update as a key-value object. Keys are column IDs, values depend on column type.",
    ),
  }),
  async execute({ itemId, name, columnValues }) {
    const item = await updateItem(itemId, {
      name,
      columnValues,
    });

    return {
      success: true,
      item: {
        id: item.id,
        name: item.name,
        state: item.state,
        columnValues: item.column_values?.map((col) => ({
          id: col.id,
          title: col.title,
          text: col.text,
          type: col.type,
        })),
      },
    };
  },
});
