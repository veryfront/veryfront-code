import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTableRowCount, listTables } from "../../lib/neon-client.ts";

export default tool({
  id: "list-tables",
  description:
    "List all tables in the connected database. Returns table names, schemas, and row counts to help understand the database structure.",
  inputSchema: z.object({
    schema: z.string().default("public").describe("Schema name to list tables from"),
    includeRowCounts: z.boolean().default(false).describe(
      "Whether to include row counts for each table (slower but more informative)",
    ),
  }),
  async execute({ schema, includeRowCounts }) {
    const tables = await listTables(schema);

    const results = [];
    for (const table of tables) {
      const result: {
        tablename: string;
        schemaname: string;
        tableowner: string;
        rowCount?: number;
      } = {
        tablename: table.tablename,
        schemaname: table.schemaname,
        tableowner: table.tableowner,
      };

      if (includeRowCounts) {
        try {
          result.rowCount = await getTableRowCount(table.tablename, schema);
        } catch (_error) {
          // Skip row count if there's an error
          result.rowCount = undefined;
        }
      }

      results.push(result);
    }

    return {
      schema,
      tableCount: results.length,
      tables: results,
    };
  },
});
