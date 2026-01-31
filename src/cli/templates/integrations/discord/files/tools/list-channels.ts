import { tool } from "veryfront/tool";
import { z } from "zod";
import { getChannelTypeName, listChannels } from "../../lib/discord-client.ts";

export default tool({
  id: "list-channels",
  description:
    "List all channels in a Discord server (guild). Returns channel names, IDs, types, and basic information.",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the Discord server (guild) to list channels from"),
    includeCategories: z.boolean().default(true).describe("Whether to include category channels"),
  }),
  async execute({ guildId, includeCategories }) {
    const channels = await listChannels(guildId);

    const filteredChannels = includeCategories
      ? channels
      : channels.filter((channel) => channel.type !== 4);

    return filteredChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: getChannelTypeName(channel.type),
      typeId: channel.type,
      topic: channel.topic,
      nsfw: channel.nsfw,
      position: channel.position,
      parentId: channel.parent_id,
      lastMessageId: channel.last_message_id,
    }));
  },
});
