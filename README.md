# Veryfront

[![CI/CD](https://github.com/veryfront/veryfront-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/veryfront/veryfront-renderer/actions/workflows/ci.yml)

Veryfront is a **zero-config React framework** for building **agentic applications**. Automatically discovers agents, tools, and routes through file-based conventions.


## Project Structure

```
my-ai-app/
├── .env
├── app/
│   ├── chat/page.tsx
│   └── api/chat/route.ts
├── agents/
│   └── assistant.ts         # AI agents
├── tools/
│   └── calculator.ts        # MCP tools
├── workflows/
│   └── onboarding.ts        # Durable workflows
├── prompts/
│   └── system.ts            # Prompt templates
└── resources/
    └── users/profile.ts     # MCP resources
```

All directories are auto-discovered. No config required.

---

## Quick Start

**1. Install**
```bash
deno add npm:veryfront npm:ai npm:zod
```

**2. Create an agent**

`agents/assistant.ts`:
```typescript
import { agent } from 'veryfront/agent';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant.',
  tools: { calculator: true },
});
```

**3. Add a tool**

`tools/calculator.ts`:
```typescript
import { tool } from 'veryfront/tool';
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
import { agentRegistry } from 'veryfront/agent';

export async function POST(req: Request) {
  const assistant = agentRegistry.get('assistant');
  return assistant.respond(req);
}
```

**5. Add the UI**

`app/chat/page.tsx`:
```tsx
'use client';
import { Chat } from 'veryfront/components/ai';
import { useChat } from 'veryfront/agent/react';

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
import { Chat } from 'veryfront/components/ai';
```

**Primitives** (bring your own styles):
```tsx
import { ChatContainer, MessageList, MessageItem } from 'veryfront/primitives';
```

**Headless hooks** (total control):
```tsx
import { useChat } from 'veryfront/agent/react';
```

---

## Model Context Protocol

MCP exposes your tools and resources to external AI applications. Enabled by default.

**Add a resource:**

`resources/users/profile.ts`:
```typescript
import { resource } from 'veryfront/resource';
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

See [veryfront.com/docs](https://veryfront.com/docs/framework) for complete documentation.

---

## Examples

```bash
cd examples/agent-basic
deno run --allow-net --allow-env --allow-read example.ts
```

See [examples/](./examples/) for more.

---

## License

MIT - see [LICENSE](./LICENSE)
