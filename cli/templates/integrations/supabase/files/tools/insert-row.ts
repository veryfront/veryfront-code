import { tool } from "veryfront/tool";
import { z } from "zod";
import { insertRow } from "../../lib/supabase-client.ts";

export default tool({
  id: "insert-row",
  description: "Insert a new row into a Supabase table. Returns the created row.",
  inputSchema: z.object({
    tableName: z.string().describe("The name of the table to insert into"),
    data: z
      .record(z.unknown())
      .describe("The data to insert as key-value pairs matching the table schema"),
  }),
  async execute({ tableName, data }) {
    try {
      const row = await insertRow(tableName, data);

      return {
        success: true,
        tableName,
        row,
        message: `Successfully inserted row into ${tableName}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        tableName,
        error: errorMessage,
        message: `Failed to insert row into ${tableName}: ${errorMessage}`,
      };
    }
  },
});
