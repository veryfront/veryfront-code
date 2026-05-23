---
title: "Create agent"
description: "Define an AI agent."
order: 4
---

## Prerequisites

- A Veryfront project from [Create project](./create-project.md).
- An `agents/` directory. For a minimal setup, run `mkdir agents`.

## Define the agent

Create `agents/assistant.ts`:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a concise assistant. Answer in one short paragraph.",
});
```

The file name becomes the agent id unless the agent config sets another `id`.

## Verify it worked

Confirm `agents/assistant.ts` exports the `assistant` agent. The next page uses
that id in the API route.

Next, expose the agent with [Create API](./create-api.md).
