import { tool } from "veryfront/ai";
import { z } from "zod";
import { listDatabases } from "../../lib/snowflake-client.ts";

export default tool({
  id: "list-databases",
  description:
    "List all databases in your Snowflake account. Returns database names, creation dates, owners, and comments.",
  inputSchema: z.object({
    includeDetails: z.boolean().default(true).describe(
      "Include detailed information like creation date, owner, and comments",
    ),
  }),
  async execute({ includeDetails }) {
    const databases = await listDatabases();

    if (!includeDetails) {
      return {
        count: databases.length,
        databases: databases.map((db) => db.name),
      };
    }

    return {
      count: databases.length,
      databases: databases.map((db) => ({
        name: db.name,
        createdOn: db.created_on,
        owner: db.owner,
        comment: db.comment || null,
      })),
    };
  },
});
