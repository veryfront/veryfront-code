import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type {
  TransportRequestInit,
  VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { Conversation } from "./conversation.ts";
import { conversationsProblemOf } from "./request.ts";
import type {
  ConversationDetails,
  ConversationMessage,
  ConversationPageInfo,
  ConversationParticipant,
} from "./types.ts";

const BASE_URL = "https://api.example.test";
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
  signal?: AbortSignal;
}

/** An in-memory transport: records each request and decodes a queued response through `onResponse`. */
function createRecordingTransport(responses: Response[]) {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];
  const transport: VeryfrontApiTransport<unknown> = {
    request(path: string, init: TransportRequestInit = {}) {
      requests.push({
        method: init.method ?? "GET",
        path,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        headers: new Headers(init.headers),
        signal: init.signal,
      });
      const response = queue.shift();
      if (!response) return Promise.reject(new Error(`No response queued for ${path}`));
      if (!init.onResponse) return Promise.reject(new Error("The SDK must decode the response"));
      return init.onResponse(response, init, `${BASE_URL}${path}`, init.signal);
    },
  };
  return { transport, requests };
}

const WIRE_CONVERSATION = {
  id: CONVERSATION_ID,
  project_id: PROJECT_ID,
  responding_agent_id: null,
  type: "chat",
  title: "Release notes",
  summary: null,
  status: "active",
  current_node: MESSAGE_ID,
  message_count: 2,
  last_message_at: "2026-10-10T10:00:00.000Z",
  metadata: { source: "sdk" },
  created_by: USER_ID,
  archived_at: null,
  created_at: "2026-10-10T09:00:00.000Z",
  updated_at: "2026-10-10T10:00:00.000Z",
  participants: [{
    id: "participant-1",
    participant_id: "participant-1",
    participant_type: "user",
    user_id: USER_ID,
    agent_id: null,
    display_name: "Ada",
    avatar_url: null,
    role: "owner",
  }],
};

const SDK_CONVERSATION: ConversationDetails = {
  id: CONVERSATION_ID,
  projectId: PROJECT_ID,
  respondingAgentId: null,
  type: "chat",
  title: "Release notes",
  summary: null,
  status: "active",
  currentNode: MESSAGE_ID,
  messageCount: 2,
  lastMessageAt: "2026-10-10T10:00:00.000Z",
  metadata: { source: "sdk" },
  createdBy: USER_ID,
  archivedAt: null,
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  participants: [{
    id: "participant-1",
    participantId: "participant-1",
    participantType: "user",
    userId: USER_ID,
    agentId: null,
    displayName: "Ada",
    avatarUrl: null,
    role: "owner",
  }],
};

const WIRE_MESSAGE = {
  id: MESSAGE_ID,
  conversation_id: CONVERSATION_ID,
  parent_id: null,
  seq: 1,
  role: "user",
  created_by: USER_ID,
  sender_type: "user",
  sender_id: USER_ID,
  sender_display_name: "Ada",
  parts: [{ type: "text", text: "Hello", provider_metadata: { keep_me: true } }],
  model: null,
  run_usage: null,
  token_usage: { input: 3, reasoning_tokens: 1 },
  finish_reason: null,
  cost_credits: null,
  status: "completed",
  edited_at: null,
  idempotency_key: "key-1",
  metadata: { trace_id: "t-1" },
  created_at: "2026-10-10T09:30:00.000Z",
  updated_at: null,
};

const SDK_MESSAGE: ConversationMessage = {
  id: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  parentId: null,
  seq: 1,
  role: "user",
  createdBy: USER_ID,
  senderType: "user",
  senderId: USER_ID,
  senderDisplayName: "Ada",
  parts: [{ type: "text", text: "Hello", provider_metadata: { keep_me: true } }],
  model: null,
  runUsage: null,
  tokenUsage: { input: 3, reasoning_tokens: 1 },
  finishReason: null,
  costCredits: null,
  status: "completed",
  editedAt: null,
  idempotencyKey: "key-1",
  metadata: { trace_id: "t-1" },
  createdAt: "2026-10-10T09:30:00.000Z",
  updatedAt: null,
};

const WIRE_PARTICIPANT = {
  id: "participant-2",
  conversation_id: CONVERSATION_ID,
  participant_id: "participant-2",
  participant_type: "user",
  user_id: USER_ID,
  agent_id: null,
  display_name: "Grace",
  avatar_url: null,
  role: "member",
  last_read_message_id: null,
  notification_preference: "all",
  joined_at: "2026-10-10T09:45:00.000Z",
};

const SDK_PARTICIPANT: ConversationParticipant = {
  id: "participant-2",
  participantId: "participant-2",
  participantType: "user",
  userId: USER_ID,
  agentId: null,
  displayName: "Grace",
  avatarUrl: null,
  role: "member",
  conversationId: CONVERSATION_ID,
  lastReadMessageId: null,
  notificationPreference: "all",
  joinedAt: "2026-10-10T09:45:00.000Z",
};

const EMPTY_PAGE_INFO: ConversationPageInfo = { self: null, first: null, next: null, prev: null };

function attached(responses: Response[]) {
  const recording = createRecordingTransport(responses);
  return {
    ...recording,
    conversation: Conversation.attach(CONVERSATION_ID, { transport: recording.transport }),
  };
}

describe("conversations SDK collection methods", () => {
  it("lists conversations with the canonical query names and returns clients", async () => {
    const { transport, requests } = createRecordingTransport([
      Response.json({
        data: [WIRE_CONVERSATION],
        page_info: { self: null, first: null, next: "cursor-2", prev: null },
      }),
    ]);

    const page = await Conversation.list({
      projectReference: "my-project",
      type: "chat",
      participantIds: [USER_ID, MESSAGE_ID],
      agentId: "assistant",
      userId: USER_ID,
      search: "release notes",
      sortBy: "created_at",
      sortOrder: "asc",
      cursor: "cursor-1",
      limit: 10,
    }, { transport });

    assertEquals(requests[0]?.method, "GET");
    const url = new URL(`${BASE_URL}${requests[0]?.path}`);
    assertEquals(url.pathname, "/conversations");
    assertEquals(Object.fromEntries(url.searchParams), {
      project_reference: "my-project",
      type: "chat",
      participant_ids: `${USER_ID},${MESSAGE_ID}`,
      agent_id: "assistant",
      user_id: USER_ID,
      search: "release notes",
      sort_by: "created_at",
      sort_order: "asc",
      cursor: "cursor-1",
      limit: "10",
    });
    assertEquals(page.pageInfo, { self: null, first: null, next: "cursor-2", prev: null });
    assertEquals(page.data.length, 1);
    assert(page.data[0] instanceof Conversation);
    assertEquals(page.data[0].id, CONVERSATION_ID);
    assertEquals(page.data[0].details, SDK_CONVERSATION);
  });

  it("lists conversations without a query when no filter is given", async () => {
    const { transport, requests } = createRecordingTransport([
      Response.json({ data: [], page_info: EMPTY_PAGE_INFO }),
    ]);

    const page = await Conversation.list({}, { transport });

    assertEquals(requests[0]?.path, "/conversations");
    assertEquals(page, { data: [], pageInfo: EMPTY_PAGE_INFO });
  });

  it("reads one conversation", async () => {
    const { transport, requests } = createRecordingTransport([Response.json(WIRE_CONVERSATION)]);

    const conversation = await Conversation.get(CONVERSATION_ID, { transport });

    assertEquals(requests[0]?.method, "GET");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}`);
    assertEquals(requests[0]?.body, undefined);
    assertEquals(conversation.id, CONVERSATION_ID);
    assertEquals(conversation.details, SDK_CONVERSATION);
  });

  it("creates a conversation with project_reference and a user initial message", async () => {
    const { transport, requests } = createRecordingTransport([
      Response.json({ ...WIRE_CONVERSATION, initial_message_id: MESSAGE_ID }, { status: 201 }),
    ]);

    const conversation = await Conversation.create({
      projectReference: PROJECT_ID,
      type: "chat",
      title: "Release notes",
      metadata: { source: "sdk" },
      idempotencyKey: "create-1",
      initialMessage: {
        parts: [{ type: "text", text: "Hello" }],
        composingUserId: USER_ID,
        idempotencyKey: "message-1",
        metadata: { trace_id: "t-1" },
      },
    }, { transport });

    assertEquals(requests[0]?.method, "POST");
    assertEquals(requests[0]?.path, "/conversations");
    assertEquals(requests[0]?.headers.get("Content-Type"), "application/json");
    assertEquals(requests[0]?.body, {
      project_reference: PROJECT_ID,
      type: "chat",
      title: "Release notes",
      metadata: { source: "sdk" },
      idempotency_key: "create-1",
      initial_message: {
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        composing_user_id: USER_ID,
        idempotency_key: "message-1",
        metadata: { trace_id: "t-1" },
      },
    });
    assertEquals(conversation.details, { ...SDK_CONVERSATION, initialMessageId: MESSAGE_ID });
  });

  it("sends an empty create body when no field is given", async () => {
    const { transport, requests } = createRecordingTransport([
      Response.json({ ...WIRE_CONVERSATION, initial_message_id: null }, { status: 201 }),
    ]);

    const conversation = await Conversation.create({}, { transport });

    assertEquals(requests[0]?.body, {});
    assertEquals(conversation.details?.initialMessageId, null);
  });

  it("attaches to a conversation without a request", () => {
    const { transport, requests } = createRecordingTransport([]);

    const conversation = Conversation.attach(CONVERSATION_ID, { transport });

    assertEquals(conversation.id, CONVERSATION_ID);
    assertEquals(conversation.details, undefined);
    assertEquals(requests.length, 0);
    assertThrows(() => Conversation.attach("", { transport }), TypeError, "conversation ID");
  });

  it("requires a transport", () => {
    assertThrows(
      () => Conversation.attach(CONVERSATION_ID, {} as never),
      TypeError,
      "createConversationsApiTransport",
    );
  });
});

describe("conversations SDK conversation methods", () => {
  it("updates a conversation and resolves with the updated conversation", async () => {
    const { conversation, requests } = attached([
      Response.json({ ...WIRE_CONVERSATION, status: "archived", title: "Archived notes" }),
    ]);

    const updated = await conversation.update({
      title: "Archived notes",
      summary: "Done",
      status: "archived",
      projectReference: "my-project",
    });

    assertEquals(requests[0]?.method, "PATCH");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}`);
    assertEquals(requests[0]?.body, {
      title: "Archived notes",
      summary: "Done",
      status: "archived",
      project_reference: "my-project",
    });
    assertEquals(updated.details?.status, "archived");
    assertEquals(updated.details?.title, "Archived notes");
  });

  it("deletes a conversation and resolves with nothing for 204", async () => {
    const { conversation, requests } = attached([new Response(null, { status: 204 })]);

    assertEquals(await conversation.delete(), undefined);

    assertEquals(requests[0]?.method, "DELETE");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}`);
    assertEquals(requests[0]?.body, undefined);
  });

  it("lists messages with cursor and limit and keeps parts unchanged", async () => {
    const { conversation, requests } = attached([
      Response.json({
        data: [WIRE_MESSAGE],
        page_info: { self: "1", first: null, next: "2", prev: null },
      }),
      Response.json({ data: [], page_info: EMPTY_PAGE_INFO }),
    ]);

    const page = await conversation.listMessages({ cursor: "1", limit: 20 });
    await conversation.listMessages();

    assertEquals(requests[0]?.method, "GET");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/messages?cursor=1&limit=20`);
    assertEquals(requests[1]?.path, `/conversations/${CONVERSATION_ID}/messages`);
    assertEquals(page.data, [SDK_MESSAGE]);
    assertEquals(page.pageInfo, { self: "1", first: null, next: "2", prev: null });
  });

  it("reads one message", async () => {
    const { conversation, requests } = attached([Response.json(WIRE_MESSAGE)]);

    assertEquals(await conversation.getMessage(MESSAGE_ID), SDK_MESSAGE);

    assertEquals(requests[0]?.method, "GET");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}`);
  });

  it("creates a user message", async () => {
    const { conversation, requests } = attached([Response.json(WIRE_MESSAGE, { status: 201 })]);

    const message = await conversation.createMessage({
      parts: [{ type: "text", text: "Hello" }],
      parentId: MESSAGE_ID,
      composingUserId: USER_ID,
      idempotencyKey: "key-1",
      metadata: { trace_id: "t-1" },
    });

    assertEquals(requests[0]?.method, "POST");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/messages`);
    assertEquals(requests[0]?.body, {
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
      composing_user_id: USER_ID,
      idempotency_key: "key-1",
      metadata: { trace_id: "t-1" },
      parent_id: MESSAGE_ID,
    });
    assertEquals(message, SDK_MESSAGE);
  });

  it("updates the parts of a message", async () => {
    const { conversation, requests } = attached([Response.json(WIRE_MESSAGE)]);

    await conversation.updateMessage(MESSAGE_ID, { parts: [{ type: "text", text: "Edited" }] });

    assertEquals(requests[0]?.method, "PATCH");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}`);
    assertEquals(requests[0]?.body, { parts: [{ type: "text", text: "Edited" }] });
  });

  it("deletes a message", async () => {
    const { conversation, requests } = attached([new Response(null, { status: 204 })]);

    assertEquals(await conversation.deleteMessage(MESSAGE_ID), undefined);

    assertEquals(requests[0]?.method, "DELETE");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}`);
  });

  it("lists message branches under the message path", async () => {
    const { conversation, requests } = attached([
      Response.json({ data: [WIRE_MESSAGE], page_info: EMPTY_PAGE_INFO }),
    ]);

    const page = await conversation.listMessageBranches(MESSAGE_ID);

    assertEquals(requests[0]?.method, "GET");
    assertEquals(
      requests[0]?.path,
      `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/branches`,
    );
    assertEquals(page, { data: [SDK_MESSAGE], pageInfo: EMPTY_PAGE_INFO });
  });

  it("creates a message branch with the message in the path, not the body", async () => {
    const { conversation, requests } = attached([Response.json(WIRE_MESSAGE, { status: 201 })]);

    const message = await conversation.createMessageBranch(MESSAGE_ID, {
      parts: [{ type: "text", text: "Alternative" }],
      composingUserId: USER_ID,
    });

    assertEquals(requests[0]?.method, "POST");
    assertEquals(
      requests[0]?.path,
      `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/branches`,
    );
    assertEquals(requests[0]?.body, {
      parts: [{ type: "text", text: "Alternative" }],
      composing_user_id: USER_ID,
    });
    assertEquals(message, SDK_MESSAGE);
  });

  it("updates the branch selection", async () => {
    const { conversation, requests } = attached([Response.json({ message_id: MESSAGE_ID })]);

    assertEquals(await conversation.updateBranchSelection(MESSAGE_ID), { messageId: MESSAGE_ID });

    assertEquals(requests[0]?.method, "PUT");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/branch-selection`);
    assertEquals(requests[0]?.body, { message_id: MESSAGE_ID });
  });

  it("lists participants", async () => {
    const { conversation, requests } = attached([
      Response.json({ data: [WIRE_PARTICIPANT], page_info: EMPTY_PAGE_INFO }),
    ]);

    const page = await conversation.listParticipants();

    assertEquals(requests[0]?.method, "GET");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/participants`);
    assertEquals(page, { data: [SDK_PARTICIPANT], pageInfo: EMPTY_PAGE_INFO });
  });

  it("creates a participant", async () => {
    const { conversation, requests } = attached([
      Response.json(WIRE_PARTICIPANT, { status: 201 }),
    ]);

    const participant = await conversation.createParticipant({ userId: USER_ID, role: "viewer" });

    assertEquals(requests[0]?.method, "POST");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/participants`);
    assertEquals(requests[0]?.body, { user_id: USER_ID, role: "viewer" });
    assertEquals(participant, SDK_PARTICIPANT);
  });

  it("deletes a participant", async () => {
    const { conversation, requests } = attached([new Response(null, { status: 204 })]);

    assertEquals(await conversation.deleteParticipant(USER_ID), undefined);

    assertEquals(requests[0]?.method, "DELETE");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/participants/${USER_ID}`);
  });

  it("reads the read state and names the conversation", async () => {
    const { conversation, requests } = attached([
      Response.json({ last_read_message_id: null, unread_count: 3 }),
    ]);

    assertEquals(await conversation.getReadState(), {
      conversationId: CONVERSATION_ID,
      lastReadMessageId: null,
      unreadCount: 3,
    });

    assertEquals(requests[0]?.method, "GET");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/read-state`);
  });

  it("updates the read state", async () => {
    const { conversation, requests } = attached([
      Response.json({ last_read_message_id: MESSAGE_ID, unread_count: 0 }),
    ]);

    assertEquals(await conversation.updateReadState({ messageId: MESSAGE_ID }), {
      conversationId: CONVERSATION_ID,
      lastReadMessageId: MESSAGE_ID,
      unreadCount: 0,
    });

    assertEquals(requests[0]?.method, "PUT");
    assertEquals(requests[0]?.path, `/conversations/${CONVERSATION_ID}/read-state`);
    assertEquals(requests[0]?.body, { message_id: MESSAGE_ID });
  });
});

describe("conversations SDK request handling", () => {
  it("encodes path parameters", async () => {
    const recording = createRecordingTransport([Response.json(WIRE_MESSAGE)]);
    const conversation = Conversation.attach("a/b?c", { transport: recording.transport });

    await conversation.getMessage("../admin");

    assertEquals(recording.requests[0]?.path, "/conversations/a%2Fb%3Fc/messages/..%2Fadmin");
  });

  it("rejects an empty path parameter before sending", async () => {
    const { conversation, requests } = attached([]);

    await assertRejects(() => conversation.getMessage(""), TypeError, "message_id");
    assertEquals(requests.length, 0);
  });

  it("rejects a dot-segment path parameter before sending", async () => {
    for (const segment of [".", ".."]) {
      const { conversation, requests } = attached([]);

      await assertRejects(() => conversation.deleteMessage(segment), TypeError, "message_id");
      await assertRejects(() => conversation.getMessage(segment), TypeError, "message_id");
      await assertRejects(() => conversation.deleteParticipant(segment), TypeError, "user_id");
      assertEquals(requests.length, 0);

      const recording = createRecordingTransport([]);
      const dotConversation = Conversation.attach(segment, { transport: recording.transport });
      await assertRejects(() => dotConversation.delete(), TypeError, "conversation_id");
      await assertRejects(
        () => Conversation.get(segment, { transport: recording.transport }),
        TypeError,
        "conversation_id",
      );
      assertEquals(recording.requests.length, 0);
    }
  });

  it("passes the caller's signal to the transport", async () => {
    const { conversation, requests } = attached([Response.json(WIRE_MESSAGE)]);
    const controller = new AbortController();

    await conversation.getMessage(MESSAGE_ID, { signal: controller.signal });

    assertEquals(requests[0]?.signal, controller.signal);
  });

  it("throws an API client error that carries the problem body", async () => {
    const problem = {
      type: "https://veryfront.com/problems/not-found",
      title: "Not found",
      status: 404,
      detail: "Conversation not found",
      instance: `/conversations/${CONVERSATION_ID}`,
    };
    const { transport } = createRecordingTransport([
      new Response(JSON.stringify(problem), {
        status: 404,
        headers: { "Content-Type": "application/problem+json" },
      }),
    ]);

    const error = await assertRejects(
      () => Conversation.get(CONVERSATION_ID, { transport }),
      VeryfrontError,
      "getConversation failed with status 404",
    ) as VeryfrontError;

    assertEquals(error.status, 404);
    assertEquals(conversationsProblemOf(error), problem);
  });

  it("keeps the problem body out of the error message and the log", async () => {
    const callerData = "caller-idempotency-key-5f1c";
    const problem = {
      type: "https://veryfront.com/problems/conflict",
      title: `Conflict for ${callerData}`,
      status: 409,
      detail: `The idempotency key ${callerData} was already used`,
    };
    const { conversation } = attached([
      new Response(JSON.stringify(problem), {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      }),
    ]);
    const levels = ["debug", "info", "log", "warn", "error"] as const;
    const originals = levels.map((level) => console[level]);
    const logged: string[] = [];
    for (const level of levels) {
      console[level] = (...values: unknown[]) => {
        logged.push(JSON.stringify(values));
      };
    }

    let error: VeryfrontError;
    try {
      error = await assertRejects(
        () =>
          conversation.createMessage({
            parts: [{ type: "text", text: "hi" }],
            idempotencyKey: callerData,
          }),
        VeryfrontError,
      ) as VeryfrontError;
    } finally {
      levels.forEach((level, index) => {
        console[level] = originals[index]!;
      });
    }

    assert(!logged.join("\n").includes(callerData), "the log contains the problem body");
    assertEquals(error.message, "createConversationMessage failed with status 409");
    assertEquals(conversationsProblemOf(error), problem);
  });

  it("builds a problem from the status line when the error body is not a problem", async () => {
    const { conversation } = attached([
      new Response("upstream unavailable", { status: 503, statusText: "Service Unavailable" }),
    ]);

    const error = await assertRejects(
      () => conversation.listMessages(),
      VeryfrontError,
    ) as VeryfrontError;

    assertEquals(error.status, 503);
    assertEquals(conversationsProblemOf(error), {
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
    });
  });

  it("rejects a success body that is not a JSON object", async () => {
    const { conversation } = attached([Response.json([WIRE_MESSAGE])]);

    const error = await assertRejects(
      () => conversation.getMessage(MESSAGE_ID),
      VeryfrontError,
      "not a JSON object",
    ) as VeryfrontError;

    assertEquals(error.status, 502);
  });

  it("rejects a list body without a data array or page_info instead of an empty page", async () => {
    const bodies: unknown[] = [
      {},
      { error: "unavailable" },
      { data: null, page_info: EMPTY_PAGE_INFO },
      { data: [WIRE_MESSAGE, "not-an-object"], page_info: EMPTY_PAGE_INFO },
      { data: [] },
      { data: [], page_info: null },
      { data: [], page_info: { self: null, first: null, prev: null } },
      { data: [], page_info: { ...EMPTY_PAGE_INFO, next: 2 } },
    ];
    for (const body of bodies) {
      const { transport } = createRecordingTransport([Response.json(body)]);
      const listError = await assertRejects(
        () => Conversation.list({}, { transport }),
        VeryfrontError,
        "invalid response",
      ) as VeryfrontError;
      assertEquals(listError.status, 502);

      for (
        const read of [
          (c: Conversation) => c.listMessages(),
          (c: Conversation) => c.listMessageBranches(MESSAGE_ID),
          (c: Conversation) => c.listParticipants(),
        ]
      ) {
        const { conversation } = attached([Response.json(body)]);
        await assertRejects(() => read(conversation), VeryfrontError, "invalid response");
      }
    }
  });

  it("rejects a resource body with a missing or mistyped field and does not echo the value", async () => {
    const cases: Array<[string, (c: Conversation) => Promise<unknown>, unknown]> = [
      ["id", (c) => c.getMessage(MESSAGE_ID), { ...WIRE_MESSAGE, id: undefined }],
      ["seq", (c) => c.getMessage(MESSAGE_ID), { ...WIRE_MESSAGE, seq: "secret-seq" }],
      ["parts", (c) => c.getMessage(MESSAGE_ID), { ...WIRE_MESSAGE, parts: undefined }],
      ["metadata", (c) => c.getMessage(MESSAGE_ID), { ...WIRE_MESSAGE, metadata: "secret" }],
      ["message_count", (c) => c.update({ title: "x" }), {
        ...WIRE_CONVERSATION,
        message_count: undefined,
      }],
      ["participants", (c) => c.update({ title: "x" }), {
        ...WIRE_CONVERSATION,
        participants: "secret",
      }],
      ["joined_at", (c) => c.createParticipant({ userId: USER_ID }), {
        ...WIRE_PARTICIPANT,
        joined_at: undefined,
      }],
      ["unread_count", (c) => c.getReadState(), { last_read_message_id: null }],
      ["last_read_message_id", (c) => c.getReadState(), { unread_count: 0 }],
      ["message_id", (c) => c.updateBranchSelection(MESSAGE_ID), {}],
    ];
    for (const [field, call, body] of cases) {
      const { conversation } = attached([Response.json(body)]);
      const error = await assertRejects(
        () => call(conversation),
        VeryfrontError,
        `invalid response: ${field} must be`,
      ) as VeryfrontError;
      assertEquals(error.status, 502);
      assert(!error.message.includes("secret"));
    }

    const { transport } = createRecordingTransport([Response.json({ error: "unavailable" })]);
    await assertRejects(
      () => Conversation.get(CONVERSATION_ID, { transport }),
      VeryfrontError,
      "invalid response: id must be",
    );
  });

  it("returns undefined for errors the SDK did not throw", () => {
    assertEquals(conversationsProblemOf(new Error("boom")), undefined);
  });
});
