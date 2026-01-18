import { tool } from "veryfront/tool";
import { z } from "zod";
import { getQueryStatus, runQuery } from "../../lib/snowflake-client.ts";

export default tool({
  id: "run-query",
  description:
    "Execute a SQL query against your Snowflake data warehouse. Supports SELECT, INSERT, UPDATE, DELETE, and other SQL operations.",
  inputSchema: z.object({
    sql: z.string().describe(
      "The SQL query to execute. Can be SELECT, INSERT, UPDATE, DELETE, or DDL statements.",
    ),
    database: z.string().optional().describe(
      "The database to use for this query. If not specified, uses the default database.",
    ),
    schema: z.string().optional().describe(
      "The schema to use for this query. If not specified, uses the default schema.",
    ),
    timeout: z.number().min(1).max(300).default(60).describe(
      "Query timeout in seconds (1-300). Default is 60 seconds.",
    ),
    async: z.boolean().default(false).describe(
      "Execute query asynchronously. If true, returns immediately with a statement handle to check status later.",
    ),
  }),
  async execute({ sql, database, schema, timeout, async: asyncExec }) {
    const result = await runQuery(sql, database, schema, {
      timeout,
      async: asyncExec,
    });

    // Handle async execution
    if (asyncExec && result.statementHandle) {
      return {
        status: "submitted",
        statementHandle: result.statementHandle,
        message:
          "Query submitted for async execution. Use the statement handle to check status.",
      };
    }

    // Handle synchronous result
    return {
      status: "completed",
      sql,
      database: database || "default",
      schema: schema || "PUBLIC",
      columns: result.columns,
      rowCount: result.rowCount,
      rows: result.rows,
      statementHandle: result.statementHandle,
    };
  },
});

/**
 * Additional tool for checking query status (for async queries)
 */
export const checkQueryStatus = tool({
  id: "check-query-status",
  description:
    "Check the status and retrieve results of an asynchronously executed query.",
  inputSchema: z.object({
    statementHandle: z.string().describe(
      "The statement handle returned from an async query execution.",
    ),
  }),
  async execute({ statementHandle }) {
    const status = await getQueryStatus(statementHandle);

    // Check if query is complete
    if (status.code === "090001") {
      // Query is still running
      return {
        status: "running",
        message: status.message,
        statementHandle,
      };
    }

    if (status.code === "000000" || !status.code) {
      // Query completed successfully
      const columns = status.resultSetMetaData?.rowType.map((col) => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
      })) || [];

      const rows: Record<string, unknown>[] = [];
      if (status.data && status.resultSetMetaData) {
        const columnNames = status.resultSetMetaData.rowType.map((col) => col.name);
        for (const row of status.data) {
          const obj: Record<string, unknown> = {};
          columnNames.forEach((name, index) => {
            obj[name] = row[index];
          });
          rows.push(obj);
        }
      }

      return {
        status: "completed",
        columns,
        rowCount: status.resultSetMetaData?.numRows || 0,
        rows,
        stats: status.stats,
        statementHandle,
      };
    }

    // Query failed
    return {
      status: "failed",
      code: status.code,
      message: status.message,
      statementHandle,
    };
  },
});
