import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getGuildIconUrl, listGuilds } from "../../lib/discord-client.ts";

export default tool({
  id: "list-guilds",
  description:
    "List all Discord servers (guilds) the authenticated user is a member of. Returns server names, IDs, and basic information.",
  inputSchema: defineSchema((v) => v.object({
    includeIcons: v
      .boolean()
      .default(false)
      .describe("Whether to include icon URLs for servers"),
  }))(),
  async execute({ includeIcons }) {
    const guilds = await listGuilds();

    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      owner: guild.owner,
      icon: includeIcons ? getGuildIconUrl(guild) : undefined,
      features: guild.features,
      permissions: guild.permissions,
    }));
  },
});
