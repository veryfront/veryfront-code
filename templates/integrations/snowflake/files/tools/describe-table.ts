import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { describeTable, getTableRowCount } from "../lib/snowflake-client.ts";

export default tool({
  id: "snowflake-describe-table",
  description:
    "Get detailed schema information about a specific table in Snowflake. Returns column names, data types, constraints, and table statistics.",
  inputSchema: defineSchema((v) => v.object({
    database: v.string().describe("The name of the database containing the table"),
    schema: v
      .string()
      .default("PUBLIC")
      .describe("The name of the schema containing the table. Defaults to PUBLIC."),
    table: v.string().describe("The name of the table to describe"),
    includeRowCount: v
      .boolean()
      .default(false)
      .describe(
        "Include the current row count for the table (may be slow for large tables)",
      ),
  }))(),
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
