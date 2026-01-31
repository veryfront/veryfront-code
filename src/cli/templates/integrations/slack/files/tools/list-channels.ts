import { tool } from "veryfront/tool";
import { z } from "zod";
import { createSlackClient } from "../../lib/slack-client.ts";

type SlackChannel = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  topic?: { value: string };
  purpose?: { value: string };
};

export default tool({
  id: "list-channels",
  description: "List Slack channels the user is a member of",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of channels to return"),
    excludeArchived: z
      .boolean()
      .default(true)
      .describe("Exclude archived channels"),
  }),
  execute: async ({ limit, excludeArchived }, context) => {
    const userId = context?.userId ?? "current-user";

    try {
      const slack = createSlackClient(userId);
      const channels = await slack.listChannels({ limit, excludeArchived });
      const count = channels.length;

      return {
        channels: channels.map((ch: SlackChannel) => ({
          id: ch.id,
          name: ch.name,
          isPrivate: ch.is_private,
          isMember: ch.is_member,
          topic: ch.topic?.value ?? null,
          purpose: ch.purpose?.value ?? null,
        })),
        count,
        message: `Found ${count} channel(s).`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Slack not connected. Please connect your Slack account.",
          connectUrl: "/api/auth/slack",
        };
      }

      throw error;
    }
  },
});
