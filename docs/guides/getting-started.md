---
title: "Getting Started"
description: "From zero to deployed AI app. Install Veryfront, scaffold a project, run it locally, and ship it to production."
order: 0
---

# Getting Started with Veryfront

Build and deploy your first AI-powered app. This guide takes you from installation to a live production URL.

---

## Install

One command. That's it.

```bash
curl -fsSL https://veryfront.com/install.sh | sh
```

Or via npm:

```bash
npm install -g veryfront
```

---

## Create your project

```bash
veryfront new my-app
```

The interactive wizard lets you pick a template:

| Template | What you get |
|----------|-------------|
| **chat** | AI chatbot with agent, tools, streaming UI |
| **rag** | Chat with your docs (retrieval-augmented generation) |
| **workflow** | Multi-step AI pipeline with approvals + parallelism |
| **multi-agent** | Agents that delegate to each other as tools |
| **coding-agent** | AI code assistant with file read/write/edit |
| **saas** | Full SaaS with auth, per-user chat, memory |
| **minimal** | Blank canvas |

Skip the wizard with `--template`:

```bash
veryfront new my-app --template chat
```

---

## Run locally

```bash
cd my-app
veryfront dev
```

Open [http://localhost:3000](http://localhost:3000). Edits reload instantly.

Your project looks like this:

```
my-app/
  agents/
    assistant.ts        # AI agent definition
  tools/
    calculator.ts       # Tool the agent can call
  prompts/
    assistant.ts        # System prompt
  app/
    layout.tsx          # Root layout
    page.tsx            # Chat UI
    api/
      chat/
        route.ts        # Streaming chat endpoint
  veryfront.config.ts
  package.json
```

Agents, tools, prompts, and workflows are **auto-discovered** from their directories. No registration, no wiring.

---

## The code

Here's what just got generated. Three files, one working AI app.

**Define an agent:**

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4o",
  system: "You are a helpful assistant.",
  tools: true,  // auto-attach all discovered tools
});
```

**Stream it to the frontend:**

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const assistant = getAgent("assistant");
  return assistant.stream({ messages }).toDataStreamResponse();
}
```

**Render the chat UI:**

```tsx
// app/page.tsx
'use client'
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

---

## Push to Veryfront Cloud

When you're ready to go live:

```bash
veryfront deploy
```

That's it. Your app is now live at:

```
https://my-app.veryfront.com
```

### Set environment variables

Your deployed app needs API keys. Set them with:

```bash
veryfront env set OPENAI_API_KEY sk-...
```

---

## Preview deployments

Every branch gets its own preview URL. Ship a feature branch without touching production:

```bash
veryfront deploy --branch feature-x
```

Your preview is live at:

```
https://my-app-feature-x.preview.veryfront.com
```

When it's ready, merge and deploy to production.

---

## Production build (self-hosted)

Prefer to host it yourself? Build and run:

```bash
veryfront build
veryfront start
```

Or use Docker:

```dockerfile
FROM denoland/deno:2.6.0
WORKDIR /app
COPY . .
RUN deno task build
EXPOSE 3000
CMD ["deno", "task", "start"]
```

---

## What's next

You've got a running AI app with a deployed URL. Here's where to go from here:

- **[Project Structure](./project-structure.md)** -- understand the directory layout
- **[Agents](./agents.md)** -- memory, multi-model, composition
- **[Tools](./tools.md)** -- Zod-validated, type-safe tool definitions
- **[Workflows](./workflows.md)** -- DAG orchestration with branching and human approval
- **[Chat UI](./chat-ui.md)** -- customize the `<Chat />` component
- **[API Routes](./api-routes.md)** -- backend HTTP handlers
- **[Deploying](./deploying.md)** -- environments, custom domains, Docker
