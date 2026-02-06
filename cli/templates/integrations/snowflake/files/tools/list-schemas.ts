import { tool } from "veryfront/tool";
import { z } from "zod";
import { listSchemas } from "../../lib/snowflake-client.ts";

export default tool({
  id: "list-schemas",
  description:
    "List all schemas in a Snowflake database. Returns schema names, database names, creation dates, and owners.",
  inputSchema: z.object({
    database: z
      .string()
      .describe("The name of the database to list schemas from"),
    includeDetails: z
      .boolean()
      .default(true)
      .describe(
        "Include detailed information like creation date, owner, and comments",
      ),
  }),
  async execute({ database, includeDetails }) {
    const schemas = await listSchemas(database);
    const count = schemas.length;

    if (!includeDetails) {
      return {
        database,
        count,
        schemas: schemas.map(({ name }) => name),
      };
    }

    return {
      database,
      count,
      schemas: schemas.map(({ name, database_name, created_on, owner, comment }) => ({
        name,
        databaseName: database_name,
        createdOn: created_on,
        owner,
        comment: comment ?? null,
      })),
    };
  },
});
