import { tool } from "veryfront/tool";
import { z } from "zod";
import { describeTable, getTableRowCount } from "../../lib/neon-client.ts";

export default tool({
  id: "describe-table",
  description:
    "Get detailed schema information for a specific table including column names, data types, nullability, defaults, and constraints.",
  inputSchema: z.object({
    tableName: z.string().describe("Name of the table to describe"),
    schema: z.string().default("public").describe("Schema name where the table is located"),
  }),
  async execute({ tableName, schema }) {
    const tableInfo = await describeTable(tableName, schema);

    const rowCount = await getTableRowCount(tableName, schema).catch(() => undefined);

    return {
      tableName: tableInfo.tableName,
      schema: tableInfo.schema,
      rowCount,
      columnCount: tableInfo.columns.length,
      columns: tableInfo.columns.map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === "YES",
        default: col.column_default,
        maxLength: col.character_maximum_length,
      })),
    };
  },
});
