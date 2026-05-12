import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatUsername, sendMessage } from "../../lib/discord-client.ts";

export default tool({
  id: "send-message",
  description: "Send a message to a Discord channel. Returns the sent message details.",
  inputSchema: defineSchema((v) => v.object({
    channelId: v.string().describe("The ID of the Discord channel to send the message to"),
    content: v
      .string()
      .min(1)
      .max(2000)
      .describe("The message content to send (1-2000 characters)"),
    tts: v
      .boolean()
      .default(false)
      .describe("Whether this message should be sent as text-to-speech"),
  }))(),
  async execute({ channelId, content, tts }) {
    const message = await sendMessage(channelId, content, { tts });

    return {
      id: message.id,
      content: message.content,
      channelId: message.channel_id,
      timestamp: message.timestamp,
      author: {
        id: message.author.id,
        username: formatUsername(message.author),
        globalName: message.author.global_name,
      },
      tts: message.tts,
    };
  },
});
