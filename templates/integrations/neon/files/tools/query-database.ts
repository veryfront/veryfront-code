import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { query } from "../lib/neon-client.ts";

export default tool({
  id: "neon-query-database",
  description:
    "Execute SQL queries against the connected Neon database. Supports parameterized queries for safety. Use this to retrieve, analyze, or search data.",
  inputSchema: defineSchema((v) => v.object({
    sql: v.string().describe("SQL query to execute. Use $1, $2, etc. for parameters"),
    params: v
      .array(v.union([v.string(), v.number(), v.boolean(), v.null()]))
      .optional()
      .describe("Optional array of parameter values for the query"),
    limit: v.number().min(1).max(1000).default(100).describe("Maximum number of rows to return"),
  }))(),
  async execute({ sql, params, limit }) {
    const trimmedSql = sql.trim();
    const isSelectQuery = /^SELECT/i.test(trimmedSql);
    const hasLimit = /LIMIT\s+\d+/i.test(trimmedSql);

    const finalSql = isSelectQuery && !hasLimit ? `${trimmedSql} LIMIT ${limit}` : trimmedSql;
    const result = await query(finalSql, params);

    return {
      rows: result.rows,
      rowCount: result.rowCount,
      limited: isSelectQuery && result.rowCount >= limit,
    };
  },
});
