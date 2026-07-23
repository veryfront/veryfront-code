import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createTeamsClient } from "../lib/teams-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-teams",
  description:
    "List all Microsoft Teams that the authenticated user is a member of. Returns team IDs, names, descriptions, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      limit: v
        .number()
        .min(1)
        .max(50)
        .default(25)
        .describe("Maximum number of teams to return (1-50)"),
    })
  )(),
  async execute({ limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createTeamsClient(userId);
    const teams = await client.listTeams({ limit });

    return teams.map((team) => ({
      id: team.id,
      name: team.displayName,
      description: team.description,
      visibility: team.visibility,
      isArchived: team.isArchived,
      createdAt: team.createdDateTime,
      webUrl: team.webUrl,
    }));
  },
});
