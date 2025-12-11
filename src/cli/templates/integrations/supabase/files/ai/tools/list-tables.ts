import { tool } from "veryfront/ai";
import { z } from "zod";
import { getTableColumns, listTables } from "../../lib/supabase-client.ts";

export default tool({
  id: "list-tables",
  description: "List all tables in your Supabase database with their schema information.",
  inputSchema: z.object({
    includeColumns: z.boolean().default(false).describe(
      "Include column information for each table",
    ),
  }),
  async execute({ includeColumns }) {
    const tables = await listTables();

    if (!includeColumns) {
      return {
        count: tables.length,
        tables: tables.map((t) => ({
          name: t.table_name,
          schema: t.table_schema,
          type: t.table_type,
        })),
      };
    }

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

    return {
      count: tablesWithColumns.length,
      tables: tablesWithColumns,
    };
  },
});
