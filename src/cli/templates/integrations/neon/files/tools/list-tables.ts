import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTableRowCount, listTables } from "../../lib/neon-client.ts";

export default tool({
  id: "list-tables",
  description:
    "List all tables in the connected database. Returns table names, schemas, and row counts to help understand the database structure.",
  inputSchema: z.object({
    schema: z.string().default("public").describe("Schema name to list tables from"),
    includeRowCounts: z
      .boolean()
      .default(false)
      .describe("Whether to include row counts for each table (slower but more informative)"),
  }),
  async execute({ schema, includeRowCounts }) {
    const tables = await listTables(schema);

    const results = await Promise.all(
      tables.map(async (table) => {
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

        if (!includeRowCounts) return result;

        try {
          result.rowCount = await getTableRowCount(table.tablename, schema);
        } catch {
          result.rowCount = undefined;
        }

        return result;
      }),
    );

    return {
      schema,
      tableCount: results.length,
      tables: results,
    };
  },
});
