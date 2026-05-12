import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { updateRow, updateRows } from "../../lib/supabase-client.ts";

export default tool({
  id: "update-row",
  description: "Update rows in a Supabase table. Can update by ID or by custom filter conditions.",
  inputSchema: defineSchema((v) => v.object({
    tableName: v.string().describe("The name of the table to update"),
    id: v
      .union([v.string(), v.number()])
      .optional()
      .describe("The ID of the row to update (if updating a single row by ID)"),
    filter: v
      .record(v.string(), v.unknown())
      .optional()
      .describe('Filter conditions to match rows to update (e.g., {"status": "pending"})'),
    data: v.record(v.string(), v.unknown()).describe("The data to update as key-value pairs"),
  }))(),
  async execute({ tableName, id, filter, data }) {
    if (id == null && filter == null) {
      return {
        success: false,
        tableName,
        error: "Either id or filter must be provided",
        message: "You must specify either an id or filter conditions to update rows",
      };
    }

    try {
      if (id != null) {
        const row = await updateRow(tableName, id, data);
        return {
          success: true,
          tableName,
          rowsUpdated: 1,
          row,
          message: `Successfully updated row with id ${id} in ${tableName}`,
        };
      }

      const rows = await updateRows(tableName, filter, data);
      return {
        success: true,
        tableName,
        rowsUpdated: rows.length,
        rows,
        message: `Successfully updated ${rows.length} row(s) in ${tableName}`,
      };
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
