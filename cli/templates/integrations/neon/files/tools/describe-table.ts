import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { describeTable, getTableRowCount } from "../../lib/neon-client.ts";

export default tool({
  id: "describe-table",
  description:
    "Get detailed schema information for a specific table including column names, data types, nullability, defaults, and constraints.",
  inputSchema: defineSchema((v) => v.object({
    tableName: v.string().describe("Name of the table to describe"),
    schema: v
      .string()
      .default("public")
      .describe("Schema name where the table is located"),
  }))(),
  async execute({ tableName, schema }): Promise<{
    tableName: string;
    schema: string;
    rowCount: number | undefined;
    columnCount: number;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      default: unknown;
      maxLength: number | null;
    }>;
  }> {
    const tableInfo = await describeTable(tableName, schema);
    const rowCount = await getTableRowCount(tableName, schema).catch(
      () => undefined,
    );

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
