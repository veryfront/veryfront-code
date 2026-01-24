import { tool } from "veryfront/tool";
import { z } from "zod";
import { listDatabases } from "../../lib/snowflake-client.ts";

export default tool({
  id: "list-databases",
  description:
    "List all databases in your Snowflake account. Returns database names, creation dates, owners, and comments.",
  inputSchema: z.object({
    includeDetails: z
      .boolean()
      .default(true)
      .describe("Include detailed information like creation date, owner, and comments"),
  }),
  async execute({ includeDetails }) {
    const databases = await listDatabases();

    const count = databases.length;

    if (!includeDetails) {
      return {
        count,
        databases: databases.map((db) => db.name),
      };
    }

    return {
      count,
      databases: databases.map((db) => ({
        name: db.name,
        createdOn: db.created_on,
        owner: db.owner,
        comment: db.comment || null,
      })),
    };
  },
});
