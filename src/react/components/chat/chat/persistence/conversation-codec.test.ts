import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage, ChatMessagePart } from "#veryfront/agent/react";
import { buildCurrentParts } from "#veryfront/agent/react/use-chat/streaming/parts-builder.ts";
import type { OrderedToolCall } from "#veryfront/agent/react/use-chat/streaming/types.ts";
import {
  CONVERSATION_STORAGE_FORMAT,
  CONVERSATION_STORAGE_LIMITS,
  CONVERSATION_STORAGE_VERSION,
  conversationBlobStorageKey,
  conversationIndexStorageKey,
  conversationTransactionJournalStorageKey,
  decodeConversationIndex,
  decodeConversationRecord,
  encodeConversationIndex,
  encodeConversationRecord,
  legacyConversationBlobStorageKey,
  legacyConversationIndexStorageKey,
} from "./conversation-codec.ts";
import {
  type Conversation,
  ConversationStoreError,
  type ConversationSummary,
} from "./conversation-store.ts";
import type { ConversationStoreLockRunner } from "./conversation-store-lock.ts";
import { createLocalConversationStore, type StorageLike } from "./local-conversation-store.ts";

const IMMEDIATE_LOCK_RUNNER: ConversationStoreLockRunner = {
  async run<T>(
    _name: string,
    criticalSection: () => T | PromiseLike<T>,
  ): Promise<T> {
    return await criticalSection();
  },
};

function textMessage(id = "message-1", text = "hello"): ChatMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function conversation(
  id = "conversation-1",
  over: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title: `Conversation ${id}`,
    messages: [textMessage()],
    createdAt: 100,
    updatedAt: 200,
    ...over,
  };
}

function summary(id: string, updatedAt = 200): ConversationSummary {
  return {
    id,
    title: `Conversation ${id}`,
    messageCount: 1,
    createdAt: 100,
    updatedAt,
  };
}

function fakeStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function testLocalConversationStore(storageKey: string, storage: StorageLike) {
  return createLocalConversationStore(storageKey, storage, IMMEDIATE_LOCK_RUNNER);
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, key);
  } else {
    Object.defineProperty(target, key, descriptor);
  }
}

describe("conversation persistence keys and envelopes", () => {
  it("uses injective tuple keys for ambiguous legacy components", () => {
    const first = conversationBlobStorageKey("tenant-region", "thread");
    const second = conversationBlobStorageKey("tenant", "region-thread");

    assert(first !== second);
    assert(
      conversationIndexStorageKey("tenant") !==
        conversationBlobStorageKey("tenant", "index"),
    );
    assert(
      conversationTransactionJournalStorageKey("tenant") !==
        conversationIndexStorageKey("tenant"),
    );
    assert(
      conversationTransactionJournalStorageKey("tenant") !==
        conversationBlobStorageKey("tenant", "transaction-journal"),
    );
    assertEquals(
      JSON.parse(conversationTransactionJournalStorageKey("tenant")),
      [CONVERSATION_STORAGE_FORMAT, "tenant", "transaction-journal"],
      "the control slot stays stable across future record-format versions",
    );
  });

  it("round-trips current versioned envelopes", () => {
    const encodedConversation = encodeConversationRecord(conversation());
    const conversationEnvelope = JSON.parse(encodedConversation.serialized);
    assertEquals(conversationEnvelope.format, CONVERSATION_STORAGE_FORMAT);
    assertEquals(conversationEnvelope.version, CONVERSATION_STORAGE_VERSION);
    assertEquals(conversationEnvelope.kind, "conversation");
    assertEquals(decodeConversationRecord(encodedConversation.serialized).legacy, false);

    const encodedIndex = encodeConversationIndex([summary("older", 100), summary("newer", 200)]);
    const indexEnvelope = JSON.parse(encodedIndex.serialized);
    assertEquals(indexEnvelope.kind, "index");
    assertEquals(decodeConversationIndex(encodedIndex.serialized).legacy, false);
    assertEquals(
      decodeConversationIndex(encodedIndex.serialized).value.map((item) => item.id),
      ["newer", "older"],
    );
  });

  it("persists canonical streaming tool parts with absent optional fields", () => {
    const toolCalls = new Map<string, OrderedToolCall>([
      [
        "tool-1",
        {
          toolCallId: "tool-1",
          toolName: "search",
          inputText: "",
          state: "input-streaming",
          order: 0,
        },
      ],
    ]);
    const parts = buildCurrentParts(
      new Map(),
      new Map(),
      toolCalls,
    );
    const message: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      parts,
    };

    const encoded = encodeConversationRecord(
      conversation("tool-conversation", { messages: [message] }),
    );

    assertEquals(
      decodeConversationRecord(encoded.serialized).value.messages[0]?.parts,
      [
        {
          type: "tool-search",
          toolCallId: "tool-1",
          toolName: "search",
          state: "input-streaming",
        },
      ],
    );
  });

  it("accepts legacy unversioned records but rejects unsupported envelopes", () => {
    const legacyConversation = decodeConversationRecord(JSON.stringify(conversation("legacy")));
    const legacyIndex = decodeConversationIndex(JSON.stringify([summary("legacy")]));
    assertEquals(legacyConversation.legacy, true);
    assertEquals(legacyIndex.legacy, true);

    const unsupported = JSON.stringify({
      format: CONVERSATION_STORAGE_FORMAT,
      version: CONVERSATION_STORAGE_VERSION + 1,
      kind: "conversation",
      value: conversation(),
    });
    assertThrows(
      () => decodeConversationRecord(unsupported),
      TypeError,
      "Unsupported conversation storage version",
    );

    // A well-formed envelope of the WRONG kind is rejected too, so a
    // conversation blob can never be read back as an index (or vice versa).
    assertThrows(
      () => decodeConversationIndex(encodeConversationRecord(conversation()).serialized),
      TypeError,
      "kind does not match",
      "a conversation envelope cannot be decoded as an index",
    );
    assertThrows(
      () => decodeConversationRecord(encodeConversationIndex([summary("a")]).serialized),
      TypeError,
      "kind does not match",
      "an index envelope cannot be decoded as a conversation",
    );
  });

  it("returns ordinary objects without allowing __proto__ assignment to mutate prototypes", () => {
    const input = conversation("prototype", {
      messages: [{
        id: "message-prototype",
        role: "assistant",
        parts: [{ type: "data-payload", data: { nested: true } }],
        metadata: JSON.parse('{"__proto__":{"polluted":true},"safe":true}'),
      }],
    });
    const encoded = encodeConversationRecord(input);
    const decoded = decodeConversationRecord(encoded.serialized).value;
    const message = decoded.messages[0]!;
    const part = message.parts[0] as { data: object };
    const encodedIndex = encodeConversationIndex([summary("prototype")]);
    const decodedIndex = decodeConversationIndex(encodedIndex.serialized);

    assertEquals(Object.getPrototypeOf(encoded.value), Object.prototype);
    assertEquals(Object.getPrototypeOf(decoded), Object.prototype);
    assertEquals(Object.getPrototypeOf(message), Object.prototype);
    assertEquals(Object.getPrototypeOf(part), Object.prototype);
    assertEquals(Object.getPrototypeOf(part.data), Object.prototype);
    assertEquals(Object.getPrototypeOf(message.metadata), Object.prototype);
    assertEquals(Object.getPrototypeOf(encodedIndex.value[0]!), Object.prototype);
    assertEquals(Object.getPrototypeOf(decodedIndex.value[0]!), Object.prototype);
    assertEquals(
      (message.metadata as Record<string, unknown>).__proto__,
      { polluted: true },
    );
    assertEquals((Object.prototype as { polluted?: boolean }).polluted, undefined);
  });

  it("ignores inherited envelope fields and rejects inherited required fields", () => {
    const validLegacyRaw = JSON.stringify(conversation("legacy-own-fields"));
    const pollution = {
      format: CONVERSATION_STORAGE_FORMAT,
      version: CONVERSATION_STORAGE_VERSION,
      kind: "conversation",
      value: conversation("inherited-envelope"),
      id: "inherited-id",
      title: "Inherited title",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    } as const;
    const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
    let inheritedReads = 0;
    let decodedLegacyId: string | undefined;
    let malformedRejected = false;

    try {
      for (const [key, value] of Object.entries(pollution)) {
        originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
        const descriptor = Object.create(null) as PropertyDescriptor;
        descriptor.configurable = true;
        descriptor.get = () => {
          inheritedReads += 1;
          return value;
        };
        Object.defineProperty(Object.prototype, key, descriptor);
      }

      decodedLegacyId = decodeConversationRecord(validLegacyRaw).value.id;
      try {
        decodeConversationRecord("{}");
      } catch {
        malformedRejected = true;
      }
    } finally {
      for (const [key, descriptor] of originals) {
        restoreProperty(Object.prototype, key, descriptor);
      }
    }

    assertEquals(decodedLegacyId, "legacy-own-fields");
    assertEquals(malformedRejected, true);
    assertEquals(inheritedReads, 0);
  });

  it("never consults inherited Object or Array toJSON hooks", () => {
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    let hookReads = 0;
    let encodedConversation = "";
    let encodedIndex = "";
    let blobKey = "";

    try {
      const inheritedHook = (): () => { replaced: boolean } => {
        hookReads += 1;
        return () => ({ replaced: true });
      };
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        get: inheritedHook,
      });
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        get: inheritedHook,
      });

      encodedConversation = encodeConversationRecord(conversation("hook-free")).serialized;
      encodedIndex = encodeConversationIndex([summary("hook-free")]).serialized;
      blobKey = conversationBlobStorageKey("hook-free", "conversation");
    } finally {
      restoreProperty(Object.prototype, "toJSON", objectToJson);
      restoreProperty(Array.prototype, "toJSON", arrayToJson);
    }

    assertEquals(hookReads, 0);
    assertEquals(JSON.parse(encodedConversation).kind, "conversation");
    assertEquals(JSON.parse(encodedIndex).kind, "index");
    assertEquals(
      blobKey,
      JSON.stringify([
        CONVERSATION_STORAGE_FORMAT,
        CONVERSATION_STORAGE_VERSION,
        "hook-free",
        "conversation",
        "conversation",
      ]),
    );
  });
});

describe("conversation codec validation", () => {
  it("accepts every canonical message-part family and normalizes message Dates", () => {
    const parts: ChatMessagePart[] = [
      { type: "text", text: "answer", state: "done" },
      {
        type: "reasoning",
        text: "thinking",
        signature: "signature",
        redactedData: "redacted",
        state: "streaming",
      },
      {
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,AAAA",
        filename: "image.png",
        size: 3,
        uploadId: "upload-1",
        uploadPath: "uploads/image.png",
      },
      {
        type: "source-url",
        sourceId: "source-1",
        url: "https://example.com",
        title: "Example",
      },
      {
        type: "source-document",
        sourceId: "source-2",
        title: "Document",
        mediaType: "application/pdf",
        filename: "document.pdf",
      },
      {
        type: "tool-search",
        toolCallId: "call-1",
        toolName: "search",
        state: "output-available",
        input: { query: "Veryfront" },
        output: { found: true },
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "search",
        result: { found: true },
        isError: false,
      },
      {
        type: "dynamic-tool",
        toolCallId: "call-2",
        toolName: "runtime-tool",
        state: "input-available",
        input: null,
      },
      { type: "step-start", stepIndex: 0 },
      { type: "step-end", stepIndex: 0 },
      { type: "data-progress", data: { percent: 100 } },
    ];
    const createdAt = new Date("2026-07-28T12:00:00.000Z");
    const input = conversation("canonical", {
      messages: [{
        id: "message-canonical",
        role: "assistant",
        parts,
        metadata: { nested: { valid: true } },
        createdAt,
      }],
    });

    const decoded = decodeConversationRecord(encodeConversationRecord(input).serialized).value;
    assertEquals(decoded.messages[0]?.createdAt, createdAt.toISOString());
    assertEquals(decoded.messages[0]?.parts, parts);
  });

  it("rejects unknown or structurally incomplete message parts", () => {
    const invalidParts: unknown[] = [
      { type: "future-part" },
      { type: "file", url: "https://example.com/file" },
      {
        type: "tool-search",
        toolCallId: "call-1",
        toolName: "different-name",
        state: "output-available",
      },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "search",
        state: "finished",
      },
      { type: "data-progress" },
      { type: "step-start", stepIndex: -1 },
    ];

    for (const part of invalidParts) {
      const input = conversation("invalid-part", {
        messages: [{
          id: "message-invalid",
          role: "assistant",
          parts: [part] as ChatMessagePart[],
        }],
      });
      assertThrows(() => encodeConversationRecord(input), TypeError);
    }
  });

  it("rejects duplicate message ids", () => {
    const input = conversation("duplicates", {
      messages: [textMessage("same", "one"), textMessage("same", "two")],
    });
    assertThrows(
      () => encodeConversationRecord(input),
      TypeError,
      "duplicate message id",
    );
  });

  it("rejects duplicate conversation ids in an index", () => {
    assertThrows(
      () => encodeConversationIndex([summary("dup"), summary("dup")]),
      TypeError,
      "duplicate conversation id",
      "an index with a repeated conversation id is rejected before it reaches storage",
    );
  });

  it("rejects values JSON would omit, coerce, or execute", () => {
    const invalidData: unknown[] = [
      { value: undefined },
      { value: Number.NaN },
      { value: -0 },
      { callback: () => undefined },
      1n,
    ];
    for (const data of invalidData) {
      const input = conversation("lossy", {
        messages: [{
          id: "message-lossy",
          role: "assistant",
          parts: [{ type: "data-payload", data }],
        }],
      });
      assertThrows(() => encodeConversationRecord(input), TypeError);
    }

    let getterCalls = 0;
    const accessorPayload = {};
    Object.defineProperty(accessorPayload, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    assertThrows(() =>
      encodeConversationRecord(conversation("accessor", {
        messages: [{
          id: "message-accessor",
          role: "assistant",
          parts: [{ type: "data-payload", data: accessorPayload }],
        }],
      }))
    );
    assertEquals(getterCalls, 0);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    assertThrows(() =>
      encodeConversationRecord(conversation("cyclic", {
        messages: [{
          id: "message-cyclic",
          role: "assistant",
          parts: [{ type: "data-payload", data: cyclic }],
        }],
      }))
    );
  });

  it("keeps the documented maximum inline attachment persistable", () => {
    const binaryBytes = 2 * 1024 * 1024;
    const base64Length = Math.ceil(binaryBytes / 3) * 4;
    const dataUrl = `data:application/octet-stream;base64,${"A".repeat(base64Length)}`;
    const input = conversation("inline-file", {
      messages: [{
        id: "message-file",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "application/octet-stream",
          url: dataUrl,
          filename: "attachment.bin",
          size: binaryBytes,
        }],
      }],
    });

    const encoded = encodeConversationRecord(input);
    assert(encoded.serialized.length < CONVERSATION_STORAGE_LIMITS.maxConversationBytes);
    assertEquals(decodeConversationRecord(encoded.serialized).value.messages.length, 1);
  });
});

describe("conversation codec resource bounds", () => {
  it("rejects oversized raw records before parsing", () => {
    assertThrows(
      () =>
        decodeConversationRecord(
          " ".repeat(CONVERSATION_STORAGE_LIMITS.maxConversationBytes + 1),
        ),
      TypeError,
      "exceeds",
    );
    assertThrows(
      () =>
        decodeConversationIndex(
          " ".repeat(CONVERSATION_STORAGE_LIMITS.maxIndexBytes + 1),
        ),
      TypeError,
      "exceeds",
    );
  });

  it("rejects excessive raw depth and node counts before parsing", () => {
    const depth = CONVERSATION_STORAGE_LIMITS.maxJsonDepth + 3;
    const deeplyNested = `${"[".repeat(depth)}0${"]".repeat(depth)}`;
    assertThrows(
      () => decodeConversationRecord(deeplyNested),
      TypeError,
      "exceeds JSON depth",
    );

    const tooManyNodes = `[${"0,".repeat(CONVERSATION_STORAGE_LIMITS.maxJsonNodes + 16)}0]`;
    assertThrows(
      () => decodeConversationRecord(tooManyNodes),
      TypeError,
      "JSON nodes",
    );
  });

  it("rejects excessive conversation, message, and part cardinality", () => {
    const tooManySummaries = Array.from(
      { length: CONVERSATION_STORAGE_LIMITS.maxConversations + 1 },
      (_, index) => summary(`summary-${index}`),
    );
    assertThrows(() => encodeConversationIndex(tooManySummaries), TypeError);

    const tooManyMessages = Array.from(
      { length: CONVERSATION_STORAGE_LIMITS.maxMessagesPerConversation + 1 },
      (_, index) => textMessage(`message-${index}`),
    );
    assertThrows(
      () => encodeConversationRecord(conversation("messages", { messages: tooManyMessages })),
      TypeError,
    );

    const tooManyParts = Array.from(
      { length: CONVERSATION_STORAGE_LIMITS.maxPartsPerMessage + 1 },
      (): ChatMessagePart => ({ type: "text", text: "part" }),
    );
    assertThrows(
      () =>
        encodeConversationRecord(conversation("parts", {
          messages: [{
            id: "message-parts",
            role: "assistant",
            parts: tooManyParts,
          }],
        })),
      TypeError,
    );
  });

  it("rejects writes whose serialized envelope exceeds its byte budget", () => {
    const halfBudget = Math.floor(CONVERSATION_STORAGE_LIMITS.maxConversationBytes / 2);
    const oversized = conversation("oversized", {
      messages: [{
        id: "message-oversized",
        role: "user",
        parts: [
          { type: "text", text: "x".repeat(halfBudget + 1_024) },
          { type: "text", text: "y".repeat(halfBudget + 1_024) },
        ],
      }],
    });
    assertThrows(
      () => encodeConversationRecord(oversized),
      TypeError,
      "serialized payload exceeds",
    );
  });
});

describe("local conversation migration", () => {
  it("reads legacy records, then migrates the index and changed blobs on write", async () => {
    const storage = fakeStorage();
    const oldConversation = conversation("old");
    const legacyIndex = JSON.stringify([summary("old")]);
    const legacyBlob = JSON.stringify(oldConversation);
    storage.setItem(legacyConversationIndexStorageKey("migration"), legacyIndex);
    storage.setItem(legacyConversationBlobStorageKey("migration", "old"), legacyBlob);
    const store = testLocalConversationStore("migration", storage);

    assertEquals((await store.list()).map((item) => item.id), ["old"]);
    assertEquals((await store.load("old"))?.title, oldConversation.title);

    await store.save(conversation("new", { updatedAt: 300 }));
    const currentIndexRaw = storage.getItem(conversationIndexStorageKey("migration"));
    const currentBlobRaw = storage.getItem(conversationBlobStorageKey("migration", "new"));
    assert(currentIndexRaw !== null);
    assert(currentBlobRaw !== null);
    assertEquals(JSON.parse(currentIndexRaw).version, CONVERSATION_STORAGE_VERSION);
    assertEquals(JSON.parse(currentBlobRaw).kind, "conversation");
    assertEquals((await store.list()).map((item) => item.id), ["new", "old"]);
    assertEquals((await store.load("old"))?.id, "old");

    await store.delete("old");
    assertEquals(await store.load("old"), null);
    assertEquals(
      storage.getItem(legacyConversationBlobStorageKey("migration", "old")),
      null,
    );
    assertEquals((await store.list()).map((item) => item.id), ["new"]);
  });

  it("finishes an owned legacy deletion when the tombstone write reports after applying", async () => {
    const base = fakeStorage();
    const storageKey = "legacy-delete-rollback";
    const id = "old";
    const currentIndexKey = conversationIndexStorageKey(storageKey);
    const legacyIndexKey = legacyConversationIndexStorageKey(storageKey);
    const legacyBlobKey = legacyConversationBlobStorageKey(storageKey, id);
    const legacyIndex = JSON.stringify([summary(id)]);
    const legacyBlob = JSON.stringify(conversation(id));
    const primary = new Error("tombstone write blocked");
    base.setItem(legacyIndexKey, legacyIndex);
    base.setItem(legacyBlobKey, legacyBlob);

    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (key === currentIndexKey) throw primary;
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore(storageKey, storage);

    const error = await assertRejects(
      () => store.delete(id),
      ConversationStoreError,
    ) as ConversationStoreError;

    assertEquals(error.cause, primary);
    assert(base.getItem(currentIndexKey) !== null);
    assertEquals(base.getItem(legacyIndexKey), legacyIndex);
    assertEquals(base.getItem(legacyBlobKey), null);
    assertEquals(await store.load(id), null);
  });

  it("keeps stores separate when their legacy concatenated blob keys collide", async () => {
    const storage = fakeStorage();
    const first = testLocalConversationStore("tenant-region", storage);
    const second = testLocalConversationStore("tenant", storage);

    await first.save(conversation("thread", { title: "First" }));
    await second.save(conversation("region-thread", { title: "Second" }));

    assertEquals((await first.load("thread"))?.title, "First");
    assertEquals((await second.load("region-thread"))?.title, "Second");
  });

  it("never deletes an ambiguous legacy blob owned by another namespace", async () => {
    const storage = fakeStorage();
    const collidingLegacyKey = legacyConversationBlobStorageKey(
      "tenant-region",
      "thread",
    );
    assertEquals(
      collidingLegacyKey,
      legacyConversationBlobStorageKey("tenant", "region-thread"),
    );

    const secondConversation = conversation("region-thread", { title: "Second legacy" });
    const secondLegacyBlob = JSON.stringify(secondConversation);
    storage.setItem(
      legacyConversationIndexStorageKey("tenant-region"),
      JSON.stringify([summary("thread")]),
    );
    storage.setItem(
      legacyConversationIndexStorageKey("tenant"),
      JSON.stringify([summary("region-thread")]),
    );
    storage.setItem(collidingLegacyKey, secondLegacyBlob);

    const first = testLocalConversationStore("tenant-region", storage);
    const second = testLocalConversationStore("tenant", storage);
    assertEquals(await first.load("thread"), null);
    await first.delete("thread");

    assertEquals(storage.getItem(collidingLegacyKey), secondLegacyBlob);
    assertEquals(await first.load("thread"), null);
    assertEquals((await second.load("region-thread"))?.title, "Second legacy");
  });

  it("ignores a foreign legacy blob that collides with its legacy index key", async () => {
    const storage = fakeStorage();
    const collidingKey = legacyConversationIndexStorageKey("tenant-region");
    assertEquals(
      collidingKey,
      legacyConversationBlobStorageKey("tenant", "region-index"),
    );

    const foreignConversation = conversation("region-index", {
      title: "Foreign legacy",
    });
    const foreignBlob = JSON.stringify(foreignConversation);
    storage.setItem(
      legacyConversationIndexStorageKey("tenant"),
      JSON.stringify([summary("region-index")]),
    );
    storage.setItem(collidingKey, foreignBlob);

    const local = testLocalConversationStore("tenant-region", storage);
    const foreign = testLocalConversationStore("tenant", storage);

    assertEquals(await local.list(), []);
    await local.save(conversation("local"));

    assertEquals((await local.list()).map((item) => item.id), ["local"]);
    assertEquals(storage.getItem(collidingKey), foreignBlob);
    assertEquals((await foreign.load("region-index"))?.title, "Foreign legacy");
  });

  it("ignores a foreign legacy index that collides with its legacy blob key", async () => {
    const storage = fakeStorage();
    const collidingKey = legacyConversationBlobStorageKey(
      "tenant",
      "region-index",
    );
    assertEquals(
      collidingKey,
      legacyConversationIndexStorageKey("tenant-region"),
    );

    const foreignIndex = JSON.stringify([summary("foreign")]);
    storage.setItem(
      legacyConversationIndexStorageKey("tenant"),
      JSON.stringify([summary("region-index")]),
    );
    storage.setItem(collidingKey, foreignIndex);

    const local = testLocalConversationStore("tenant", storage);
    const foreign = testLocalConversationStore("tenant-region", storage);

    assertEquals(await local.load("region-index"), null);
    await local.delete("region-index");

    assertEquals(storage.getItem(collidingKey), foreignIndex);
    assertEquals((await foreign.list()).map((item) => item.id), ["foreign"]);
  });

  it("still rejects same-namespace conversation bytes at its legacy index key", async () => {
    const storage = fakeStorage();
    const storageKey = "owned-corruption";
    const legacyIndexKey = legacyConversationIndexStorageKey(storageKey);
    assertEquals(
      legacyIndexKey,
      legacyConversationBlobStorageKey(storageKey, "index"),
    );
    storage.setItem(legacyIndexKey, JSON.stringify(conversation("index")));

    const error = await assertRejects(
      () => testLocalConversationStore(storageKey, storage).list(),
      ConversationStoreError,
    );

    assertEquals((error as ConversationStoreError).operation, "list");
  });

  it("recovers a valid unindexed legacy blob for the requested id", async () => {
    const storage = fakeStorage();
    const orphan = conversation("orphan", { title: "Recovered orphan" });
    storage.setItem(
      legacyConversationBlobStorageKey("orphan-recovery", "orphan"),
      JSON.stringify(orphan),
    );
    const store = testLocalConversationStore("orphan-recovery", storage);

    assertEquals((await store.load("orphan"))?.title, "Recovered orphan");
  });

  it("rejects lossy writes asynchronously without touching storage", async () => {
    const storage = fakeStorage();
    const store = testLocalConversationStore("lossy-store", storage);
    const invalid = conversation("invalid", {
      messages: [{
        id: "message-invalid",
        role: "assistant",
        parts: [{ type: "data-callback", data: () => undefined }],
      }],
    });

    const save = store.save(invalid);
    assert(save instanceof Promise);
    const error = await assertRejects(() => save, ConversationStoreError);
    assertEquals((error as ConversationStoreError).operation, "save");
    assertEquals(
      storage.getItem(conversationBlobStorageKey("lossy-store", "invalid")),
      null,
    );
  });
});
