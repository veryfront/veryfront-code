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
    ...(c.agentId !== undefined ? { agentId: c.agentId } : {}),
    messageCount: c.messages.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** In-memory conversation persistence. Optionally seed with initial conversations. */
export function memoryConversationStore(seed: Conversation[] = []): ConversationStore {
  const map = new Map<string, Conversation>();
  for (const conversation of seed) {
    const snapshot = structuredClone(conversation);
    if (map.has(snapshot.id)) {
      throw new TypeError(`Duplicate seeded conversation id: "${snapshot.id}"`);
    }
    map.set(snapshot.id, snapshot);
  }

  return {
    async list(): Promise<ConversationSummary[]> {
      return Array.from(map.values(), toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async load(id: string): Promise<Conversation | null> {
      const found = map.get(id);
      // Snapshot before returning so caller mutation after this call cannot
      // change what the promise resolves to.
      return found ? structuredClone(found) : null;
    },
    async save(conversation: Conversation): Promise<void> {
      // `async` converts clone failures into a rejected promise while the clone
      // itself still happens at call time.
      const snapshot = structuredClone(conversation);
      map.set(snapshot.id, snapshot);
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
  };
}
