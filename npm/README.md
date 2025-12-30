# Veryfront

Veryfront is a **zero-config React framework** for building **agentic applications**. Automatically discovers agents, tools, and routes through file-based conventions.


## Project Structure

```
my-ai-app/
├── .env
├── app/
│   ├── chat/page.tsx
│   └── api/chat/route.ts
└── ai/
    ├── agents/assistant.ts         # Auto-registered
    ├── tools/calculator.ts         # Auto-discovered
    └── resources/users/profile.ts  # MCP resources
```

The `ai/` directory auto-enables AI features. No config required.

---

## Quick Start

**1. Install**
```bash
deno add npm:veryfront npm:ai npm:zod
```

**2. Create an agent**

`ai/agents/assistant.ts`:
```typescript
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant.',
  tools: { calculator: true },
});
```

**3. Add a tool**

`ai/tools/calculator.ts`:
```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Perform calculations',
  inputSchema: z.object({ expression: z.string() }),
  execute: async ({ expression }) => ({ result: eval(expression) }),
});
```

**4. Create the API endpoint**

`app/api/chat/route.ts`:
```typescript
import { agents } from '../../../ai/agents';

export async function POST(req: Request) {
  return agents.assistant.respond(req);
}
```

**5. Add the UI**

`app/chat/page.tsx`:
```tsx
'use client';
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  return <Chat {...useChat({ api: '/api/chat' })} />;
}
```

**6. Run**
```bash
echo "OPENAI_API_KEY=sk-..." > .env
deno task dev
```

Visit `localhost:3000/chat` - your agent can now use the calculator tool.

---

## UI Customization

**Styled components** (production-ready):
```tsx
import { Chat } from 'veryfront/ai/components';
```

**Primitives** (bring your own styles):
```tsx
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';
```

**Headless hooks** (total control):
```tsx
import { useChat } from 'veryfront/ai/react';
```

---

## Model Context Protocol

MCP exposes your tools and resources to external AI applications. Enabled by default when `ai/` directory exists.

**Add a resource:**

`ai/resources/users/profile.ts`:
```typescript
import { resource } from 'veryfront/ai';
import { z } from 'zod';

export default resource({
  description: 'Get user profile',
  paramsSchema: z.object({ userId: z.string() }),
  async load({ userId }) {
    return await db.users.findUnique({ where: { id: userId } });
  },
});
```

**Run MCP server:**
```bash
deno task dev --mcp  # Port 3001 by default
```

---

## Features

- **Zero config** - Auto-discovery from file structure
- **Multi-runtime** - Deno, Node.js, Bun, Cloudflare Workers
- **Full-stack React** - SSR, SSG, ISR, JIT rendering
- **Remote imports** - Use `https://esm.sh/pkg` directly, no node_modules needed
- **MCP built-in** - Model Context Protocol server
- **Production-ready** - Rate limiting, caching, cost tracking, security

---

## Documentation

- [Quick Start Tutorial](./docs/learn/quickstart.md)
- [AI Getting Started](./docs/ai/getting-started.md)
- [Routing Guide](./docs/guides/routing/README.md)
- [Deployment Guide](./docs/guides/deployment/README.md)
- [API Reference](./docs/reference/ai/README.md)

[Browse all docs →](./docs/README.md)

---

## Examples

```bash
cd examples/ai-basic
deno run --allow-all demo.ts
```

See [examples/](./examples/) for more.

---

## License

MIT - see [LICENSE](./LICENSE)
