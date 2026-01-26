import { tool } from "veryfront/tool";
import { z } from "zod";
import { getConversation } from "../../lib/intercom-client.ts";

function toIsoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function toIsoFromSecondsOrNull(seconds?: number | null): string | null {
  return seconds ? toIsoFromSeconds(seconds) : null;
}

export default tool({
  id: "get-conversation",
  description:
    "Get details of a specific conversation from Intercom, including all conversation parts/messages.",
  inputSchema: z.object({
    conversationId: z.string().describe("The ID of the conversation to retrieve"),
  }),
  async execute({ conversationId }) {
    const conversation = await getConversation(conversationId);

    return {
      id: conversation.id,
      title: conversation.title,
      state: conversation.state,
      read: conversation.read,
      priority: conversation.priority,
      createdAt: toIsoFromSeconds(conversation.created_at),
      updatedAt: toIsoFromSeconds(conversation.updated_at),
      waitingSince: toIsoFromSecondsOrNull(conversation.waiting_since),
      snoozedUntil: toIsoFromSecondsOrNull(conversation.snoozed_until),
      source: {
        type: conversation.source.type,
        subject: conversation.source.subject,
        body: conversation.source.body,
        author: {
          type: conversation.source.author.type,
          id: conversation.source.author.id,
          name: conversation.source.author.name,
          email: conversation.source.author.email,
        },
      },
      conversationParts:
        conversation.conversation_parts?.conversation_parts.map((part) => ({
          id: part.id,
          partType: part.part_type,
          body: part.body,
          createdAt: toIsoFromSeconds(part.created_at),
          author: {
            type: part.author.type,
            id: part.author.id,
            name: part.author.name,
            email: part.author.email,
          },
        })) ?? [],
      contactIds: conversation.contacts?.map((c) => c.id),
      teammateIds: conversation.teammates?.map((t) => t.id),
    };
  },
});
