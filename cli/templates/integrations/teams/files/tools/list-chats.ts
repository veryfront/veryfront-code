import { tool } from "veryfront/tool";
import { z } from "zod";
import { getChatDisplayName, listChats } from "../../lib/teams-client.ts";

export default tool({
  id: "list-chats",
  description:
    "List recent Microsoft Teams chats for the authenticated user. Returns chat IDs, names, types, and last updated timestamps.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of chats to return (1-50)"),
    expandMembers: z
      .boolean()
      .default(false)
      .describe("Include chat member information"),
  }),
  async execute({ limit, expandMembers }) {
    const chats = await listChats({
      limit,
      expand: expandMembers ? ["members"] : undefined,
    });

    return chats.map((chat) => {
      const members = expandMembers
        ? chat.members?.map(({ id, displayName, email }) => ({
            id,
            displayName,
            email,
          }))
        : undefined;

      return {
        id: chat.id,
        name: getChatDisplayName(chat),
        type: chat.chatType,
        topic: chat.topic,
        lastUpdated: chat.lastUpdatedDateTime,
        created: chat.createdDateTime,
        webUrl: chat.webUrl,
        memberCount: chat.members?.length,
        members,
      };
    });
  },
});
