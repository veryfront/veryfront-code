import { tool } from "veryfront/ai";
import { z } from "zod";
import { listTables } from "../../lib/snowflake-client.ts";

export default tool({
  id: "list-tables",
  description:
    "List all tables in a Snowflake database schema. Returns table names, types, creation dates, row counts, and sizes.",
  inputSchema: z.object({
    database: z.string().describe(
      "The name of the database containing the schema",
    ),
    schema: z.string().default("PUBLIC").describe(
      "The name of the schema to list tables from. Defaults to PUBLIC.",
    ),
    includeDetails: z.boolean().default(true).describe(
      "Include detailed information like creation date, row count, size, and owner",
    ),
  }),
  async execute({ database, schema, includeDetails }) {
    const tables = await listTables(database, schema);

    if (!includeDetails) {
      return {
        database,
        schema,
        count: tables.length,
        tables: tables.map((t) => t.name),
      };
    }

    return {
      database,
      schema,
      count: tables.length,
      tables: tables.map((t) => ({
        name: t.name,
        databaseName: t.database_name,
        schemaName: t.schema_name,
        kind: t.kind,
        createdOn: t.created_on,
        rowCount: t.row_count || null,
        bytes: t.bytes || null,
        owner: t.owner,
        comment: t.comment || null,
      })),
    };
  },
});
