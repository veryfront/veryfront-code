import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createTeamsClient } from "../lib/teams-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "teams-list-channels",
  description:
    "List all channels in a specific Microsoft Team. Use list-teams first to get team IDs. Returns channel IDs, names, descriptions, and types.",
  inputSchema: defineSchema((v) =>
    v.object({
      teamId: v.string().describe("The ID of the team to list channels from"),
      limit: v
        .number()
        .min(1)
        .max(50)
        .default(25)
        .describe("Maximum number of channels to return (1-50)"),
    })
  )(),
  async execute({ teamId, limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createTeamsClient(userId);
    const channels = await client.listChannels(teamId, { limit });

    return channels.map((channel) => ({
      id: channel.id,
      name: channel.displayName,
      description: channel.description,
      email: channel.email,
      webUrl: channel.webUrl,
      membershipType: channel.membershipType,
      createdAt: channel.createdDateTime,
    }));
  },
});
