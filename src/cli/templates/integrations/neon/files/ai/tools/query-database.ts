import { tool } from "veryfront/tool";
import { z } from "zod";
import { query } from "../../lib/neon-client.ts";

export default tool({
  id: "query-database",
  description:
    "Execute SQL queries against the connected Neon database. Supports parameterized queries for safety. Use this to retrieve, analyze, or search data.",
  inputSchema: z.object({
    sql: z.string().describe("SQL query to execute. Use $1, $2, etc. for parameters"),
    params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe(
      "Optional array of parameter values for the query",
    ),
    limit: z.number().min(1).max(1000).default(100).describe("Maximum number of rows to return"),
  }),
  async execute({ sql, params, limit }) {
    // Add LIMIT clause if not present and it's a SELECT query
    let finalSql = sql.trim();
    const isSelectQuery = /^SELECT/i.test(finalSql);

    if (isSelectQuery && !/LIMIT\s+\d+/i.test(finalSql)) {
      finalSql = `${finalSql} LIMIT ${limit}`;
    }

    const result = await query(finalSql, params);

    return {
      rows: result.rows,
      rowCount: result.rowCount,
      limited: isSelectQuery && result.rowCount >= limit,
    };
  },
});
