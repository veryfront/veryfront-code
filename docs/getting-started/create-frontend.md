---
title: "Create frontend"
description: "Add a chat page that streams responses from a Veryfront agent."
order: 6
---

## Prerequisites

- A project created with [Create project](./create-project.md).
- The agent route from [Create API](./create-api.md).
- The dev server running (`veryfront dev`).

## Add the chat page

Replace `app/page.tsx` with a client page:

```tsx
// app/page.tsx
"use client";

import { Chat, useChat } from "veryfront/chat";

export default function Home() {
  const chat = useChat();

  return <Chat chat={chat} placeholder="Ask me anything..." />;
}
```

`useChat()` uses `/api/ag-ui` by default. `Chat` renders the composer,
messages, loading state, and streamed assistant response.

## Verify it worked

Open [http://localhost:3000](http://localhost:3000), send a message, and ensure
the assistant response streams into the chat.

For custom layouts, see [Chat UI](../guides/chat-ui.md).
