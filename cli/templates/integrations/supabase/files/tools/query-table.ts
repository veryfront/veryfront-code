import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { queryTable } from "../lib/supabase-client.ts";

export default tool({
  id: "supabase-query-table",
  description:
    "Query a table in your Supabase database with optional filters, sorting, and pagination.",
  inputSchema: defineSchema((v) => v.object({
    tableName: v.string().describe("The name of the table to query"),
    select: v
      .string()
      .optional()
      .describe(
        'Columns to select (comma-separated, e.g., "id,name,email"). Default is all columns (*)',
      ),
    filter: v
      .record(v.string(), v.unknown())
      .optional()
      .describe(
        'Filter conditions as key-value pairs (e.g., {"status": "active", "age": 25})',
      ),
    orderBy: v.string().optional().describe("Column to order by"),
    ascending: v
      .boolean()
      .default(true)
      .describe("Sort in ascending order (true) or descending (false)"),
    limit: v
      .number()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Maximum number of rows to return (1-1000)"),
    offset: v
      .number()
      .min(0)
      .default(0)
      .describe("Number of rows to skip (for pagination)"),
  }))(),
  async execute({
    tableName,
    select,
    filter,
    orderBy,
    ascending,
    limit,
    offset,
  }): Promise<{
    tableName: string;
    count: number;
    rows: unknown[];
    pagination: { limit: number; offset: number; hasMore: boolean };
  }> {
    const rows = await queryTable(tableName, {
      select,
      filter,
      order: orderBy ? { column: orderBy, ascending } : undefined,
      limit,
      offset,
    });

    return {
      tableName,
      count: rows.length,
      rows,
      pagination: {
        limit,
        offset,
        hasMore: rows.length === limit,
      },
    };
  },
});
