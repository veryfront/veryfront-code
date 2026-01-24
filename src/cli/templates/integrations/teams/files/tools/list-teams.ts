import { tool } from "veryfront/tool";
import { z } from "zod";
import { listTeams } from "../../lib/teams-client.ts";

export default tool({
  id: "list-teams",
  description:
    "List all Microsoft Teams that the authenticated user is a member of. Returns team IDs, names, descriptions, and metadata.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(25)
      .describe("Maximum number of teams to return (1-50)"),
  }),
  async execute({ limit }) {
    const teams = await listTeams({ limit });

    return teams.map(
      ({
        id,
        displayName,
        description,
        visibility,
        isArchived,
        createdDateTime,
        webUrl,
      }) => ({
        id,
        name: displayName,
        description,
        visibility,
        isArchived,
        createdAt: createdDateTime,
        webUrl,
      }),
    );
  },
});
