# Veryfront AI - AI SDK Integration Example

This example demonstrates the flexibility of Veryfront's AI system:

- Using Vercel AI SDK providers (30+ providers available)
- Using Veryfront custom providers (full control)
- Hybrid approach (both in same application)
- Veryfront enhancements work with both approaches

## Setup

1. Set your API key:

**Option A: Environment variable**
```bash
export OPENAI_API_KEY=sk-...
```

**Option B: .env file (recommended)**
```bash
cp ../../.env.example .env
# Then edit .env and add your API key
```

2. Run the example:

```bash
deno run --allow-net --allow-env --allow-read example.ts
```

## What It Does

1. **AI SDK Providers**: Uses battle-tested Vercel AI SDK providers
2. **Custom Providers**: Demonstrates custom provider implementation
3. **Hybrid Usage**: Shows using both approaches in same app
4. **Veryfront Enhancements**: Tools, agents, MCP work with both

## Files

- `example.ts` - Main example demonstrating integration options

## Three Integration Options

### Option 1: AI SDK Providers (Recommended)
```typescript
import { openai, generateText } from 'veryfront/ai';

const model = openai('gpt-4o', { apiKey });
const result = await generateText({
  model,
  prompt: 'Hello',
});
```

**Benefits:**
- 30+ providers (OpenAI, Anthropic, Google, Mistral, etc.)
- Battle-tested in production
- Actively maintained by Vercel
- Industry standard

### Option 2: Custom Providers (Advanced)
```typescript
import { BaseProvider, initializeProviders } from 'veryfront/ai';

class OllamaProvider extends BaseProvider {
  name = 'ollama';
  // Custom implementation...
}

initializeProviders({
  ollama: new OllamaProvider({ /* config */ }),
});
```

**Benefits:**
- Full control over requests/responses
- Custom authentication
- Internal APIs
- Special requirements

### Option 3: Hybrid (Best of Both Worlds)
```typescript
import { openai } from 'veryfront/ai';
import { initializeProviders } from 'veryfront/ai';

// Use AI SDK for standard providers
const model = openai('gpt-4o');

// Use custom for special cases
initializeProviders({
  internal: new InternalProvider(),
});
```

**Benefits:**
- AI SDK for standard providers
- Custom for special cases
- Both in same application
- No lock-in

## Veryfront Enhancements (Work with All Options)

All Veryfront features work regardless of provider choice:

- **Auto-discovery**: `ai/tools/` → auto-register
- **MCP server**: `veryfront dev --mcp`
- **Multi-agent workflows**: `createWorkflow()`
- **Agent composition**: `agentAsTool()`
- **Memory strategies**: conversation, buffer, summary
- **Three-layer UI**: hooks, primitives, styled components
- **Production middleware**: rate limit, cache, cost, security

## When to Use Each Option

**Use AI SDK Providers when:**
- You need a standard LLM provider
- You want battle-tested, production-ready code
- You prefer industry-standard approach

**Use Custom Providers when:**
- You have internal APIs
- You need custom authentication
- You require full request/response control
- You're integrating non-standard models

**Use Hybrid when:**
- You want best of both worlds
- Different parts of app have different needs
- You're migrating from custom to standard
