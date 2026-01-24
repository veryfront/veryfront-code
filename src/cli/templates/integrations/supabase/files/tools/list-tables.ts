import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTableColumns, listTables } from "../../lib/supabase-client.ts";

export default tool({
  id: "list-tables",
  description: "List all tables in your Supabase database with their schema information.",
  inputSchema: z.object({
    includeColumns: z
      .boolean()
      .default(false)
      .describe("Include column information for each table"),
  }),
  async execute({ includeColumns }): Promise<{
    count: number;
    tables: Array<{
      name: string;
      schema: string;
      type: string;
      columns?: Array<{
        name: string;
        type: string;
        nullable: boolean;
        default: unknown;
      }>;
      error?: string;
    }>;
  }> {
    const tables = await listTables();

    const baseTables = tables.map((t) => ({
      name: t.table_name,
      schema: t.table_schema,
      type: t.table_type,
    }));

    if (!includeColumns) {
      return { count: baseTables.length, tables: baseTables };
    }

    // Fetch column information for each table
    const tablesWithColumns = await Promise.all(
      tables.map(async (table) => {
        try {
          const columns = await getTableColumns(table.table_name);

          return {
            name: table.table_name,
            schema: table.table_schema,
            type: table.table_type,
            columns: columns.map((c) => ({
              name: c.column_name,
              type: c.data_type,
              nullable: c.is_nullable === "YES",
              default: c.column_default,
            })),
          };
        } catch (error) {
          return {
            name: table.table_name,
            schema: table.table_schema,
            type: table.table_type,
            columns: [],
            error: error instanceof Error ? error.message : "Failed to fetch columns",
          };
        }
      }),
    );

    return { count: tablesWithColumns.length, tables: tablesWithColumns };
  },
});
