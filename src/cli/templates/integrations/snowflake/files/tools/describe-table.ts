import { tool } from "veryfront/tool";
import { z } from "zod";
import { describeTable, getTableRowCount } from "../../lib/snowflake-client.ts";

export default tool({
  id: "describe-table",
  description:
    "Get detailed schema information about a specific table in Snowflake. Returns column names, data types, constraints, and table statistics.",
  inputSchema: z.object({
    database: z.string().describe("The name of the database containing the table"),
    schema: z
      .string()
      .default("PUBLIC")
      .describe("The name of the schema containing the table. Defaults to PUBLIC."),
    table: z.string().describe("The name of the table to describe"),
    includeRowCount: z
      .boolean()
      .default(false)
      .describe(
        "Include the current row count for the table (may be slow for large tables)",
      ),
  }),
  async execute({ database, schema, table, includeRowCount }) {
    const description = await describeTable(database, schema, table);

    const rowCount = includeRowCount
      ? await getTableRowCount(database, schema, table).catch(() => null)
      : null;

    return {
      database,
      schema,
      table,
      rowCount,
      primaryKeys: description.primaryKeys,
      columnCount: description.columns.length,
      columns: description.columns.map((col) => ({
        name: col.name,
        type: col.type,
        kind: col.kind,
        nullable: col.null === "Y",
        default: col.default || null,
        primaryKey: col.primary_key === "Y",
        uniqueKey: col.unique_key === "Y",
        check: col.check || null,
        expression: col.expression || null,
        comment: col.comment || null,
      })),
    };
  },
});
