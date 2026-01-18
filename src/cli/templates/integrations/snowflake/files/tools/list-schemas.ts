import { tool } from "veryfront/tool";
import { z } from "zod";
import { listSchemas } from "../../lib/snowflake-client.ts";

export default tool({
  id: "list-schemas",
  description:
    "List all schemas in a Snowflake database. Returns schema names, database names, creation dates, and owners.",
  inputSchema: z.object({
    database: z.string().describe(
      "The name of the database to list schemas from",
    ),
    includeDetails: z.boolean().default(true).describe(
      "Include detailed information like creation date, owner, and comments",
    ),
  }),
  async execute({ database, includeDetails }) {
    const schemas = await listSchemas(database);

    if (!includeDetails) {
      return {
        database,
        count: schemas.length,
        schemas: schemas.map((s) => s.name),
      };
    }

    return {
      database,
      count: schemas.length,
      schemas: schemas.map((s) => ({
        name: s.name,
        databaseName: s.database_name,
        createdOn: s.created_on,
        owner: s.owner,
        comment: s.comment || null,
      })),
    };
  },
});
