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
  async execute({ conversationId }): Promise<unknown> {
    const conversation = await getConversation(conversationId);

    const source = conversation.source;
    const sourceAuthor = source.author;

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
        type: source.type,
        subject: source.subject,
        body: source.body,
        author: {
          type: sourceAuthor.type,
          id: sourceAuthor.id,
          name: sourceAuthor.name,
          email: sourceAuthor.email,
        },
      },
      conversationParts:
        conversation.conversation_parts?.conversation_parts.map((part) => {
          const author = part.author;

          return {
            id: part.id,
            partType: part.part_type,
            body: part.body,
            createdAt: toIsoFromSeconds(part.created_at),
            author: {
              type: author.type,
              id: author.id,
              name: author.name,
              email: author.email,
            },
          };
        }) ?? [],
      contactIds: conversation.contacts?.map((c) => c.id),
      teammateIds: conversation.teammates?.map((t) => t.id),
    };
  },
});
