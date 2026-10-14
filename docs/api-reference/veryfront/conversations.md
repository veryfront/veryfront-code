---
title: "veryfront/conversations"
description: "Conversations: the durable threads of messages, branches, participants and read state between people and agents. Runs and input requests of a conversation are in `veryfront/runs/target`."
order: 6
---

## Import

```ts
import {
  Conversation,
  CONVERSATIONS_OPERATIONS,
  conversationsProblemOf,
  createConversationsApiTransport,
} from "veryfront/conversations";
```

## Examples

### Create a conversation and add a message

```ts
import { Conversation, createConversationsApiTransport } from "veryfront/conversations";

const transport = createConversationsApiTransport({
  baseUrl: "<API_ORIGIN>",
  getToken: () => process.env.VERYFRONT_API_TOKEN!,
});

const conversation = await Conversation.create(
  { projectReference: "<PROJECT_ID>", title: "Release notes" },
  { transport },
);
const message = await conversation.createMessage({
  parts: [{ type: "text", text: "Draft the release notes." }],
});
console.log(conversation.id, message.id);
```

### List, read, update and delete conversations

```ts
import { Conversation, createConversationsApiTransport } from "veryfront/conversations";

const transport = createConversationsApiTransport({
  baseUrl: "<API_ORIGIN>",
  getToken: () => process.env.VERYFRONT_API_TOKEN!,
});

const page = await Conversation.list({ projectReference: "<PROJECT_ID>", limit: 20 }, {
  transport,
});
console.log(page.data.map((item) => item.details?.title), page.pageInfo.next);

const conversation = await Conversation.get("<CONVERSATION_ID>", { transport });
const archived = await conversation.update({ status: "archived" });
console.log(archived.details?.status); // "archived"
await archived.delete();
```

### Read messages and work with branches

```ts
import { Conversation, createConversationsApiTransport } from "veryfront/conversations";

const transport = createConversationsApiTransport({
  baseUrl: "<API_ORIGIN>",
  getToken: () => process.env.VERYFRONT_API_TOKEN!,
});
// attach() uses a known conversation ID without reading the conversation first.
const conversation = Conversation.attach("<CONVERSATION_ID>", { transport });

let cursor: string | undefined;
do {
  const page = await conversation.listMessages({ cursor, limit: 50 });
  for (const message of page.data) console.log(message.seq, message.role);
  cursor = page.pageInfo.next ?? undefined;
} while (cursor);

const message = await conversation.getMessage("<MESSAGE_ID>");
await conversation.updateMessage(message.id, { parts: [{ type: "text", text: "Edited text." }] });
const branch = await conversation.createMessageBranch(message.id, {
  parts: [{ type: "text", text: "Another version." }],
});
const branches = await conversation.listMessageBranches("<PARENT_MESSAGE_ID>");
console.log(branches.data.length);
await conversation.updateBranchSelection(branch.id);
await conversation.deleteMessage(branch.id);
```

### Manage participants and read state

```ts
import {
  Conversation,
  conversationsProblemOf,
  createConversationsApiTransport,
} from "veryfront/conversations";

const transport = createConversationsApiTransport({
  baseUrl: "<API_ORIGIN>",
  getToken: () => process.env.VERYFRONT_API_TOKEN!,
});
const conversation = Conversation.attach("<CONVERSATION_ID>", { transport });

await conversation.createParticipant({ userId: "<USER_ID>", role: "viewer" });
const participants = await conversation.listParticipants();
console.log(participants.data.map((participant) => participant.role));
await conversation.deleteParticipant("<USER_ID>");

const readState = await conversation.getReadState();
console.log(readState.unreadCount);
try {
  await conversation.updateReadState({ messageId: "<MESSAGE_ID>" });
} catch (error) {
  // A failed request carries the API problem body, for example status 404.
  console.error(conversationsProblemOf(error)?.status);
}
```

## API

### `Conversation.list(params, options)`

List the conversations the caller can read.

**Returns:** <code>Promise&lt;ConversationPage&gt;</code>

### `Conversation.get(conversationId, options)`

Read one conversation.

**Returns:** <code>Promise&lt;Conversation&gt;</code>

### `Conversation.create(input, options)`

Start a conversation.

**Returns:** <code>Promise&lt;Conversation&gt;</code>

### `Conversation.attach(conversationId, options)`

Use an existing conversation by ID without reading it first. The client's `details` stay `undefined`.

**Returns:** `Conversation`

### `conversation.update(input, options)`

Change the title, summary, status or project. Resolves with the updated conversation.

**Returns:** <code>Promise&lt;Conversation&gt;</code>

### `conversation.delete(options)`

Delete the conversation.

**Returns:** <code>Promise&lt;void&gt;</code>

### `conversation.listMessages(params, options)`

Read one page of messages. Pass `pageInfo.next` as `cursor` to read the following page.

**Returns:** <code>Promise&lt;ConversationMessagePage&gt;</code>

### `conversation.getMessage(messageId, options)`

Read one message.

**Returns:** <code>Promise&lt;ConversationMessage&gt;</code>

### `conversation.createMessage(input, options)`

Add a user message.

**Returns:** <code>Promise&lt;ConversationMessage&gt;</code>

### `conversation.updateMessage(messageId, input, options)`

Replace the parts of a message.

**Returns:** <code>Promise&lt;ConversationMessage&gt;</code>

### `conversation.deleteMessage(messageId, options)`

Delete one message.

**Returns:** <code>Promise&lt;void&gt;</code>

### `conversation.listMessageBranches(messageId, params, options)`

List the child messages (branches) under a message. The API returns every branch in one page, so `params` has no fields.

**Returns:** <code>Promise&lt;ConversationMessagePage&gt;</code>

### `conversation.createMessageBranch(messageId, input, options)`

Create an alternative version of a message and select it.

**Returns:** <code>Promise&lt;ConversationMessage&gt;</code>

### `conversation.updateBranchSelection(messageId, options)`

Select the active branch by the message to show.

**Returns:** <code>Promise&lt;ConversationBranchSelection&gt;</code>

### `conversation.listParticipants(options)`

List the participants. The API returns every participant in one page.

**Returns:** <code>Promise&lt;ConversationParticipantPage&gt;</code>

### `conversation.createParticipant(input, options)`

Add a user to the conversation.

**Returns:** <code>Promise&lt;ConversationParticipant&gt;</code>

### `conversation.deleteParticipant(userId, options)`

Remove a user from the conversation.

**Returns:** <code>Promise&lt;void&gt;</code>

### `conversation.getReadState(options)`

Read the caller's read cursor and unread count.

**Returns:** <code>Promise&lt;ConversationReadState&gt;</code>

### `conversation.updateReadState(input, options)`

Advance the caller's read cursor to a message.

**Returns:** <code>Promise&lt;ConversationReadState&gt;</code>

## Type Reference

### `ConversationClientOptions`

Connection settings of `Conversation.list`, `get`, `create` and `attach`.

| Property    | Type                                              | Description                                                                                                                       | Source                                                                                     |
| ----------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `transport` | <code>VeryfrontApiTransport&lt;unknown&gt;</code> | Canonical Veryfront API transport, including origin, credentials and retries, for example from `createConversationsApiTransport`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |

### `CreateConversationInput`

Input of `Conversation.create`.

| Property            | Type                                    | Description                                                                     | Source                                                                                     |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `projectReference?` | `string`                                | Project ID or slug.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `type?`             | `ConversationType`                      | Defaults to `chat`.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `title?`            | `string`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `metadata?`         | `ConversationMetadata`                  | JSON object under 64 KB.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `idempotencyKey?`   | `string`                                | 1 to 255 characters. A retry with the same input returns the same conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `initialMessage?`   | `CreateConversationInitialMessageInput` | First user message, stored together with the conversation.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |

### `ConversationDetails`

A conversation as the API returns it.

| Property            | Type                               | Description                                                                                                               | Source                                                                                     |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                | `string`                           |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `projectId`         | `string \| null`                   | Project the conversation belongs to; `null` for a conversation without a project.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `respondingAgentId` | `string \| null`                   |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `type`              | `ConversationType`                 |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `title`             | `string \| null`                   |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `summary`           | `string \| null`                   |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `status`            | `ConversationStatus`               |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `currentNode`       | `string \| null`                   | Message selected as the active branch.                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `messageCount`      | `number`                           |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `lastMessageAt`     | `string \| null`                   | RFC 3339 timestamp of the latest message.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `metadata`          | `ConversationMetadata \| null`     |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `createdBy`         | `string \| null`                   |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `archivedAt`        | `string \| null`                   |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `createdAt`         | `string`                           |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `updatedAt`         | `string`                           |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `participants`      | `ConversationParticipantSummary[]` |                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `initialMessageId?` | `string \| null`                   | Message created from `initialMessage`; `null` when the conversation started empty. Only `Conversation.create` reports it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |

### `ConversationMessage`

A message of a conversation.

| Property            | Type                                                   | Description                                                    | Source                                                                                     |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                | `string`                                               |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `conversationId`    | `string`                                               |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `parentId`          | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `seq`               | `number`                                               | Position of the message in the conversation.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `role`              | `ConversationMessageRole`                              |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `createdBy`         | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `senderType`        | `ConversationMessageSenderType`                        |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `senderId`          | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `senderDisplayName` | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `parts`             | `ConversationMessagePart[]`                            |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `model`             | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `runUsage`          | <code>Record&lt;string, unknown&gt; &#124; null</code> | Run usage as the REST API reports it, with REST field names.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `tokenUsage`        | <code>Record&lt;string, unknown&gt; &#124; null</code> | Token usage as the REST API reports it, with REST field names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `finishReason`      | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `costCredits`       | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `status`            | `ConversationMessageStatus`                            |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `editedAt`          | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `idempotencyKey`    | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `metadata`          | `ConversationMetadata \| null`                         |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `createdAt`         | `string`                                               |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |
| `updatedAt`         | `string \| null`                                       |                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts) |

## Exports

### Components

| Name                       | Description                                                                      | Source                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CONVERSATIONS_OPERATIONS` | Method and path of each conversations operation, keyed by the REST operation ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/operations.ts) |

### Functions

| Name                              | Description                                                                                                                                                                | Source                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `conversationsProblemOf`          | The problem body of an error thrown by the conversations SDK, or `undefined` for any other error.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/request.ts)   |
| `createConversationsApiTransport` | Create the canonical Veryfront API transport for the conversations SDK. It owns the origin, credentials, retries, response body limits and telemetry of every SDK request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/transport.ts) |

### Classes

| Name           | Description                                                                                                      | Source                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Conversation` | A conversation: the durable thread of messages, branches, participants and read state between people and agents. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/conversation.ts) |

### Types

| Name                                    | Description                                                                                                                                              | Source                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ConversationBranchSelection`           | The message selected as the active branch of a conversation.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationCallOptions`               | Options of one conversations SDK call.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationClientOptions`             | Connection settings of `Conversation.list`, `get`, `create` and `attach`.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationDetails`                   | A conversation as the API returns it.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMessage`                   | A message of a conversation.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMessagePage`               | One page of messages.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMessagePart`               | One part of a message, for example `{ type: "text", text: "Hello" }`. The SDK sends and returns parts unchanged, with the field names the REST API uses. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMessageRole`               | Role of a message.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMessageSenderType`         | Kind of sender that wrote a message.                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMessageStatus`             | Delivery status of a message.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationMetadata`                  | Caller-defined JSON object, sent and returned unchanged.                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationPage`                      | One page of conversations.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/conversation.ts)                |
| `ConversationPageInfo`                  | Cursors of one page. Pass `next` as `cursor` to read the following page.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationPageOf`                    | One page of a list.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationParticipant`               | A participant of a conversation.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationParticipantPage`           | One page of participants.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationParticipantRole`           | Role of a participant in a conversation.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationParticipantSummary`        | Participant as a conversation embeds it.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationParticipantType`           | Kind of participant.                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationReadState`                 | The caller's read cursor and unread count in a conversation.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationsApiTransportOptions`      | Options for `createConversationsApiTransport`.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/transport.ts)                   |
| `ConversationsOperationRoute`           | HTTP route of one conversations operation.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/operations.ts)                  |
| `ConversationSortBy`                    | Field that orders a conversation list.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationSortOrder`                 | Direction of a conversation list.                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationsProblem`                  | Problem body of a failed conversations API request.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationStatus`                    | Lifecycle status of a conversation.                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ConversationType`                      | Kind of conversation.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `CreateConversationInitialMessageInput` | Message fields shared by `conversation.createMessage` and `initialMessage`.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `CreateConversationInput`               | Input of `Conversation.create`.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `CreateConversationMessageBranchInput`  | Input of `conversation.createMessageBranch`.                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `CreateConversationMessageInput`        | Input of `conversation.createMessage`. The SDK sends the message with the `user` role.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `CreateConversationParticipantInput`    | Input of `conversation.createParticipant`.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ListConversationMessageBranchesParams` | Parameters of `conversation.listMessageBranches`. The API returns every branch in one page and accepts no parameters.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ListConversationMessagesParams`        | Paging of `conversation.listMessages`.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `ListConversationsParams`               | Filters and paging of `Conversation.list`.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `TransportRetryConfig`                  | Retries after a failed attempt, with exponential backoff between `initialDelay` and `maxDelay` ms.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-transport.ts) |
| `UpdateConversationInput`               | Input of `conversation.update`.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `UpdateConversationMessageInput`        | Input of `conversation.updateMessage`.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `UpdateConversationReadStateInput`      | Input of `conversation.updateReadState`.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/conversations/types.ts)                       |
| `VeryfrontApiTransport`                 | Sends requests to the Veryfront API with the transport's origin, credentials and retries.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-transport.ts) |
