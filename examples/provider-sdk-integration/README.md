# Veryfront AI - Provider Integration Example

This example demonstrates how to configure AI model providers:

- Auto-initialized providers from environment variables
- Custom provider registration with `registerModelProvider()`
- OpenAI-compatible services (OpenRouter, Ollama) via base URL override

## Setup

1. Set your API key (choose one method):

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

## Provider Configuration

### Auto-Initialized (Recommended)

Set environment variables and providers are auto-detected on first use:

```bash
OPENAI_API_KEY=sk-...        # → "openai" provider
ANTHROPIC_API_KEY=sk-ant-... # → "anthropic" provider
GOOGLE_API_KEY=...           # → "google" provider
```

```typescript
import { agent } from 'veryfront/agent';

// No provider setup needed — just use agent()
const myAgent = agent({
  model: 'openai/gpt-4o',
  system: 'You are helpful.',
});
```

### OpenAI-Compatible Services

Override the base URL to use services like OpenRouter, Azure OpenAI, or Ollama:

```bash
OPENAI_API_KEY=sk-or-v1-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

```typescript
// Now "openai" provider routes through OpenRouter
const myAgent = agent({
  model: 'openai/meta-llama/llama-3.1-405b',
  system: 'You are helpful.',
});
```

### Custom Registration (Advanced)

Use `registerModelProvider()` for full control over provider creation:

```typescript
import { registerModelProvider } from 'veryfront/provider';
import { createOpenAI } from '@ai-sdk/openai';

// Register Ollama as a custom provider
registerModelProvider('ollama', (modelId) =>
  createOpenAI({
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
  })(modelId)
);

// Then use it
const myAgent = agent({
  model: 'ollama/llama3.2',
  system: 'You are helpful.',
});
```

## Files

- `example.ts` - Main example demonstrating all provider options

## Veryfront Enhancements (Work with All Providers)

All Veryfront features work regardless of provider choice:

- **Auto-discovery**: `ai/tools/` → auto-register
- **MCP server**: `veryfront dev --mcp`
- **Multi-agent workflows**: `createWorkflow()`
- **Agent composition**: `agentAsTool()`
- **Memory strategies**: conversation, buffer, summary
- **Production middleware**: rate limit, cache, cost, security
