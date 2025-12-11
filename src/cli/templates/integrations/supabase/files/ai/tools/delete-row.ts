import { tool } from "veryfront/ai";
import { z } from "zod";
import { deleteRow, deleteRows } from "../../lib/supabase-client.ts";

export default tool({
  id: "delete-row",
  description:
    "Delete rows from a Supabase table. Can delete by ID or by custom filter conditions. Returns the deleted rows.",
  inputSchema: z.object({
    tableName: z.string().describe("The name of the table to delete from"),
    id: z.union([z.string(), z.number()]).optional().describe(
      "The ID of the row to delete (if deleting a single row by ID)",
    ),
    filter: z.record(z.unknown()).optional().describe(
      'Filter conditions to match rows to delete (e.g., {"status": "archived"})',
    ),
    confirm: z.boolean().default(false).describe(
      "Confirm deletion (must be true to proceed with delete operation)",
    ),
  }),
  async execute({ tableName, id, filter, confirm }) {
    if (!confirm) {
      return {
        success: false,
        tableName,
        error: "Deletion not confirmed",
        message: "You must set confirm: true to delete rows. This is a safety measure.",
      };
    }

    try {
      if (!id && !filter) {
        return {
          success: false,
          tableName,
          error: "Either id or filter must be provided",
          message: "You must specify either an id or filter conditions to delete rows",
        };
      }

      if (id) {
        const result = await deleteRow(tableName, id);
        return {
          success: true,
          tableName,
          rowsDeleted: 1,
          row: result,
          message: `Successfully deleted row with id ${id} from ${tableName}`,
        };
      }

      if (filter) {
        const results = await deleteRows(tableName, filter);
        return {
          success: true,
          tableName,
          rowsDeleted: results.length,
          rows: results,
          message: `Successfully deleted ${results.length} row(s) from ${tableName}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        tableName,
        error: errorMessage,
        message: `Failed to delete row(s) from ${tableName}: ${errorMessage}`,
      };
    }
  },
});
