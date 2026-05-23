---
title: "Agent memory"
description: "How client-managed messages, server-managed memory, streaming, and storage boundaries relate in Veryfront Code."
order: 4
---

Agents are stateless unless a request supplies messages or the agent is
configured with memory. Veryfront keeps message transport, model execution, and
persisted memory as separate concerns so applications can choose the right state
boundary.

## State boundaries

| Boundary            | What it owns                                                |
| ------------------- | ----------------------------------------------------------- |
| Client messages     | The visible conversation state sent with a request.         |
| Agent memory        | Server-side history or summaries available across requests. |
| Streaming transport | Token and AG-UI events sent back to the client.             |
| Storage driver      | Persistence for memory across server instances or restarts. |

Client-managed state stays in the request payload. Server-managed memory is
useful when conversation state must survive reloads, move between clients, or be
shared across server instances. Streaming does not decide where state lives; it
only describes how output reaches the client.

## Memory strategies

Buffer memory keeps recent messages. Conversation memory keeps a bounded window.
Summary memory compresses older context. Redis-backed memory shares state across
server instances. The right strategy depends on how long the conversation should
live and whether multiple runtimes need the same state.

## Related

- [Memory and streaming](../guides/memory-and-streaming.md): configure memory
  and streaming.
- [Chat UI](../guides/chat-ui.md): render streamed agent output.
- [`veryfront/agent`](../api-reference/veryfront/agent.md): agent API reference.
- [`veryfront/chat`](../api-reference/veryfront/chat.md): chat API reference.
