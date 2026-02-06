import { tool } from "veryfront/tool";
import { z } from "zod";
import { sendMessage } from "../../lib/intercom-client.ts";

export default tool({
  id: "send-message",
  description: "Send a message or reply to an existing conversation in Intercom.",
  inputSchema: z.object({
    conversationId: z.string().describe("The ID of the conversation to reply to"),
    body: z.string().describe("The message content to send"),
    messageType: z
      .enum(["comment", "note"])
      .default("comment")
      .describe("Type of message: 'comment' (visible to user) or 'note' (internal only)"),
    adminId: z.string().optional().describe("The ID of the admin sending the message"),
  }),
  async execute({ conversationId, body, messageType, adminId }) {
    const conversation = await sendMessage({ conversationId, body, messageType, adminId });

    return {
      success: true,
      conversation: {
        id: conversation.id,
        state: conversation.state,
        updatedAt: new Date(conversation.updated_at * 1000).toISOString(),
      },
      message: `Message sent successfully to conversation ${conversationId}`,
    };
  },
});
