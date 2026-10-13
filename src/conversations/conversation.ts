/**
 * Conversations SDK client: one method per conversations REST operation.
 *
 * @module
 */
import type { VeryfrontApiTransport } from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import type { ConversationsOperationId } from "./operations.ts";
import {
  type ConversationsWireInput,
  requireConversationsTransport,
  requireResponseObject,
  sendConversationsOperation,
} from "./request.ts";
import {
  fromBranchSelection,
  fromConversation,
  fromMessage,
  fromPage,
  fromParticipant,
  fromReadState,
  toCreateConversationBody,
  toCreateMessageBody,
  toCreateMessageBranchBody,
  toCreateParticipantBody,
  toListConversationsQuery,
  toListMessagesQuery,
  toUpdateConversationBody,
} from "./wire.ts";
import type {
  ConversationBranchSelection,
  ConversationCallOptions,
  ConversationClientOptions,
  ConversationDetails,
  ConversationMessage,
  ConversationMessagePage,
  ConversationPageOf,
  ConversationParticipant,
  ConversationParticipantPage,
  ConversationReadState,
  CreateConversationInput,
  CreateConversationMessageBranchInput,
  CreateConversationMessageInput,
  CreateConversationParticipantInput,
  ListConversationMessageBranchesParams,
  ListConversationMessagesParams,
  ListConversationsParams,
  UpdateConversationInput,
  UpdateConversationMessageInput,
  UpdateConversationReadStateInput,
} from "./types.ts";

/** One page of conversations. */
export type ConversationPage = ConversationPageOf<Conversation>;

async function sendForObject(
  transport: VeryfrontApiTransport<unknown>,
  operationId: ConversationsOperationId,
  input: ConversationsWireInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return requireResponseObject(
    operationId,
    await sendConversationsOperation(transport, operationId, input, signal),
  );
}

/**
 * A conversation: the durable thread of messages, branches, participants and read state
 * between people and agents.
 */
export class Conversation {
  /** Conversation ID. */
  readonly id: string;
  /**
   * The conversation as the API returned it to `list`, `get`, `create` or `update`.
   * `undefined` on a client from `Conversation.attach`.
   */
  readonly details: ConversationDetails | undefined;
  readonly #transport: VeryfrontApiTransport<unknown>;

  private constructor(
    id: string,
    details: ConversationDetails | undefined,
    transport: VeryfrontApiTransport<unknown>,
  ) {
    this.id = id;
    this.details = details;
    this.#transport = transport;
  }

  /** List the conversations the caller can read. */
  static async list(
    params: ListConversationsParams,
    options: ConversationClientOptions,
  ): Promise<ConversationPage> {
    const transport = requireConversationsTransport(options);
    const page = await sendForObject(
      transport,
      "listConversations",
      { query: toListConversationsQuery(params) },
      options.signal,
    );
    return fromPage(page, (wire) => {
      const details = fromConversation(wire);
      return new Conversation(details.id, details, transport);
    });
  }

  /** Read one conversation. */
  static async get(
    conversationId: string,
    options: ConversationClientOptions,
  ): Promise<Conversation> {
    const transport = requireConversationsTransport(options);
    const details = fromConversation(
      await sendForObject(
        transport,
        "getConversation",
        { path: { conversation_id: conversationId } },
        options.signal,
      ),
    );
    return new Conversation(details.id, details, transport);
  }

  /** Start a conversation. */
  static async create(
    input: CreateConversationInput,
    options: ConversationClientOptions,
  ): Promise<Conversation> {
    const transport = requireConversationsTransport(options);
    const details = fromConversation(
      await sendForObject(
        transport,
        "createConversation",
        { body: toCreateConversationBody(input) },
        options.signal,
      ),
    );
    return new Conversation(details.id, details, transport);
  }

  /**
   * Use an existing conversation by ID without reading it first. The client's `details`
   * stay `undefined`.
   */
  static attach(conversationId: string, options: ConversationClientOptions): Conversation {
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      throw new TypeError("Conversation.attach requires a conversation ID");
    }
    return new Conversation(conversationId, undefined, requireConversationsTransport(options));
  }

  #path(extra: Record<string, string> = {}): Record<string, string> {
    return { conversation_id: this.id, ...extra };
  }

  /** Change the title, summary, status or project. Resolves with the updated conversation. */
  async update(
    input: UpdateConversationInput,
    options?: ConversationCallOptions,
  ): Promise<Conversation> {
    const details = fromConversation(
      await sendForObject(
        this.#transport,
        "updateConversation",
        { path: this.#path(), body: toUpdateConversationBody(input) },
        options?.signal,
      ),
    );
    return new Conversation(details.id, details, this.#transport);
  }

  /** Delete the conversation. */
  async delete(options?: ConversationCallOptions): Promise<void> {
    await sendConversationsOperation(
      this.#transport,
      "deleteConversation",
      { path: this.#path() },
      options?.signal,
    );
  }

  /** Read one page of messages. Pass `pageInfo.next` as `cursor` to read the following page. */
  async listMessages(
    params?: ListConversationMessagesParams,
    options?: ConversationCallOptions,
  ): Promise<ConversationMessagePage> {
    return fromPage(
      await sendForObject(
        this.#transport,
        "listConversationMessages",
        { path: this.#path(), query: toListMessagesQuery(params ?? {}) },
        options?.signal,
      ),
      fromMessage,
    );
  }

  /** Read one message. */
  async getMessage(
    messageId: string,
    options?: ConversationCallOptions,
  ): Promise<ConversationMessage> {
    return fromMessage(
      await sendForObject(
        this.#transport,
        "getConversationMessage",
        { path: this.#path({ message_id: messageId }) },
        options?.signal,
      ),
    );
  }

  /** Add a user message. */
  async createMessage(
    input: CreateConversationMessageInput,
    options?: ConversationCallOptions,
  ): Promise<ConversationMessage> {
    return fromMessage(
      await sendForObject(
        this.#transport,
        "createConversationMessage",
        { path: this.#path(), body: toCreateMessageBody(input) },
        options?.signal,
      ),
    );
  }

  /** Replace the parts of a message. */
  async updateMessage(
    messageId: string,
    input: UpdateConversationMessageInput,
    options?: ConversationCallOptions,
  ): Promise<ConversationMessage> {
    return fromMessage(
      await sendForObject(
        this.#transport,
        "updateConversationMessage",
        { path: this.#path({ message_id: messageId }), body: { parts: input.parts } },
        options?.signal,
      ),
    );
  }

  /** Delete one message. */
  async deleteMessage(messageId: string, options?: ConversationCallOptions): Promise<void> {
    await sendConversationsOperation(
      this.#transport,
      "deleteConversationMessage",
      { path: this.#path({ message_id: messageId }) },
      options?.signal,
    );
  }

  /**
   * List the child messages (branches) under a message. The API returns every branch in one
   * page, so `params` has no fields.
   */
  async listMessageBranches(
    messageId: string,
    // deno-lint-ignore no-unused-vars -- reserved position for list parameters
    params?: ListConversationMessageBranchesParams,
    options?: ConversationCallOptions,
  ): Promise<ConversationMessagePage> {
    return fromPage(
      await sendForObject(
        this.#transport,
        "listConversationMessageBranches",
        { path: this.#path({ message_id: messageId }) },
        options?.signal,
      ),
      fromMessage,
    );
  }

  /** Create an alternative version of a message and select it. */
  async createMessageBranch(
    messageId: string,
    input: CreateConversationMessageBranchInput,
    options?: ConversationCallOptions,
  ): Promise<ConversationMessage> {
    return fromMessage(
      await sendForObject(
        this.#transport,
        "createConversationMessageBranch",
        { path: this.#path({ message_id: messageId }), body: toCreateMessageBranchBody(input) },
        options?.signal,
      ),
    );
  }

  /** Select the active branch by the message to show. */
  async updateBranchSelection(
    messageId: string,
    options?: ConversationCallOptions,
  ): Promise<ConversationBranchSelection> {
    return fromBranchSelection(
      await sendForObject(
        this.#transport,
        "updateConversationBranchSelection",
        { path: this.#path(), body: { message_id: messageId } },
        options?.signal,
      ),
    );
  }

  /** List the participants. The API returns every participant in one page. */
  async listParticipants(
    options?: ConversationCallOptions,
  ): Promise<ConversationParticipantPage> {
    return fromPage(
      await sendForObject(
        this.#transport,
        "listConversationParticipants",
        { path: this.#path() },
        options?.signal,
      ),
      fromParticipant,
    );
  }

  /** Add a user to the conversation. */
  async createParticipant(
    input: CreateConversationParticipantInput,
    options?: ConversationCallOptions,
  ): Promise<ConversationParticipant> {
    return fromParticipant(
      await sendForObject(
        this.#transport,
        "createConversationParticipant",
        { path: this.#path(), body: toCreateParticipantBody(input) },
        options?.signal,
      ),
    );
  }

  /** Remove a user from the conversation. */
  async deleteParticipant(userId: string, options?: ConversationCallOptions): Promise<void> {
    await sendConversationsOperation(
      this.#transport,
      "deleteConversationParticipant",
      { path: this.#path({ user_id: userId }) },
      options?.signal,
    );
  }

  /** Read the caller's read cursor and unread count. */
  async getReadState(options?: ConversationCallOptions): Promise<ConversationReadState> {
    return fromReadState(
      await sendForObject(
        this.#transport,
        "getConversationReadState",
        { path: this.#path() },
        options?.signal,
      ),
      this.id,
    );
  }

  /** Advance the caller's read cursor to a message. */
  async updateReadState(
    input: UpdateConversationReadStateInput,
    options?: ConversationCallOptions,
  ): Promise<ConversationReadState> {
    return fromReadState(
      await sendForObject(
        this.#transport,
        "updateConversationReadState",
        { path: this.#path(), body: { message_id: input.messageId } },
        options?.signal,
      ),
      this.id,
    );
  }
}
