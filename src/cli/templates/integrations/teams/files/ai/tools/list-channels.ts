import { tool } from "veryfront/ai";
import { z } from "zod";
import { listChannels } from "../../lib/teams-client.ts";

export default tool({
  id: "list-channels",
  description:
    "List all channels in a specific Microsoft Team. Use list-teams first to get team IDs. Returns channel IDs, names, descriptions, and types.",
  inputSchema: z.object({
    teamId: z.string().describe("The ID of the team to list channels from"),
    limit: z.number().min(1).max(50).default(25).describe(
      "Maximum number of channels to return (1-50)",
    ),
  }),
  async execute({ teamId, limit }) {
    const channels = await listChannels(teamId, { limit });

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
