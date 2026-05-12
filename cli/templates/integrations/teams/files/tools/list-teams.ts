import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listTeams } from "../../lib/teams-client.ts";

export default tool({
  id: "list-teams",
  description:
    "List all Microsoft Teams that the authenticated user is a member of. Returns team IDs, names, descriptions, and metadata.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(50)
      .default(25)
      .describe("Maximum number of teams to return (1-50)"),
  }))(),
  async execute({ limit }) {
    const teams = await listTeams({ limit });

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
