/**
 * memoryConversationStore — an in-memory {@link ConversationStore}. Useful for
 * tests, SSR, and ephemeral (no-persistence) chats. Holds full conversations in
 * a Map; `list()` derives summaries on demand.
 *
 * @module react/components/chat/persistence/memory-conversation-store
 */
import type { Conversation, ConversationStore, ConversationSummary } from "./conversation-store.ts";

function toSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    ...(c.agentId ? { agentId: c.agentId } : {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** In-memory conversation persistence. Optionally seed with initial conversations. */
export function memoryConversationStore(seed: Conversation[] = []): ConversationStore {
  const map = new Map<string, Conversation>(seed.map((c) => [c.id, c]));

  return {
    list(): Promise<ConversationSummary[]> {
      const summaries = Array.from(map.values(), toSummary).sort((a, b) =>
        b.updatedAt - a.updatedAt
      );
      return Promise.resolve(summaries);
    },
    load(id: string): Promise<Conversation | null> {
      const found = map.get(id);
      // Clone so callers can't mutate stored state through the returned object.
      return Promise.resolve(found ? structuredClone(found) : null);
    },
    save(conversation: Conversation): Promise<void> {
      map.set(conversation.id, structuredClone(conversation));
      return Promise.resolve();
    },
    delete(id: string): Promise<void> {
      map.delete(id);
      return Promise.resolve();
    },
  };
}
