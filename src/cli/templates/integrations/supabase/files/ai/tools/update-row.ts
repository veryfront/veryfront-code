import { tool } from "veryfront/ai";
import { z } from "zod";
import { updateRow, updateRows } from "../../lib/supabase-client.ts";

export default tool({
  id: "update-row",
  description: "Update rows in a Supabase table. Can update by ID or by custom filter conditions.",
  inputSchema: z.object({
    tableName: z.string().describe("The name of the table to update"),
    id: z.union([z.string(), z.number()]).optional().describe(
      "The ID of the row to update (if updating a single row by ID)",
    ),
    filter: z.record(z.unknown()).optional().describe(
      'Filter conditions to match rows to update (e.g., {"status": "pending"})',
    ),
    data: z.record(z.unknown()).describe("The data to update as key-value pairs"),
  }),
  async execute({ tableName, id, filter, data }) {
    try {
      if (!id && !filter) {
        return {
          success: false,
          tableName,
          error: "Either id or filter must be provided",
          message: "You must specify either an id or filter conditions to update rows",
        };
      }

      if (id) {
        const result = await updateRow(tableName, id, data);
        return {
          success: true,
          tableName,
          rowsUpdated: 1,
          row: result,
          message: `Successfully updated row with id ${id} in ${tableName}`,
        };
      }

      if (filter) {
        const results = await updateRows(tableName, filter, data);
        return {
          success: true,
          tableName,
          rowsUpdated: results.length,
          rows: results,
          message: `Successfully updated ${results.length} row(s) in ${tableName}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        tableName,
        error: errorMessage,
        message: `Failed to update row(s) in ${tableName}: ${errorMessage}`,
      };
    }
  },
});
