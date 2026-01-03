# AI Module

## Purpose

The AI module provides production-ready AI agent capabilities with MCP (Model Context Protocol) integration, multi-provider support, and first-class React integration for building intelligent applications.

## Scope

### What this module does:

- Agent runtime with tool execution and multi-step reasoning
- MCP server for AI context sharing
- Provider integrations (OpenAI, Anthropic, Google, AI SDK)
- Auto-discovery of tools, resources, and prompts
- Agent composition and workflows
- Memory management (conversation, buffer, summary)
- React hooks for streaming AI responses
- Production features (rate limiting, caching, cost tracking, security)
- Platform-aware execution (Deno, Node.js, Bun, Cloudflare Workers)

### What this module does NOT do:

- LLM model training or fine-tuning (use provider APIs)
- Vector database management (see external solutions like Pinecone, Weaviate)
- Image generation (use provider APIs like DALL-E, Midjourney)
- Speech-to-text/text-to-speech (see `@veryfront/media` when available)

## Architecture

```
ai/
├── agent/              # Agent runtime and factory
│   ├── factory.ts     # agent() factory function
│   ├── runtime.ts     # Execution engine
│   ├── memory.ts      # Memory strategies
│   └── composition.ts # Multi-agent workflows
├── mcp/               # Model Context Protocol
│   ├── server.ts      # MCP server implementation
│   ├── resource.ts    # resource() factory
│   ├── prompt.ts      # prompt() factory
│   └── registry.ts    # Central MCP registry
├── providers/         # AI provider integrations
│   ├── base.ts        # Base provider class
│   ├── openai.ts      # OpenAI provider
│   ├── anthropic.ts   # Anthropic provider
│   └── google.ts      # Google provider
├── adapters/          # Integration adapters
│   └── ai-sdk.ts      # AI SDK adapter
├── production/        # Production features
│   ├── rate-limit.ts  # Rate limiting
│   ├── cache.ts       # Response caching
│   ├── cost.ts        # Cost tracking
│   └── security.ts    # Input/output validation
├── runtime/           # Platform detection
│   └── platform.ts    # Multi-runtime support
├── utils/             # Utilities
│   ├── tool.ts        # tool() factory
│   └── discovery.ts   # Auto-discovery system
└── react/             # React integration
    ├── hooks/         # useChat, useAgent, useCompletion
    ├── primitives/    # Unstyled components
    └── components/    # Styled components
```

## Key Exports

### Factory Functions

- `agent(config)` - Create an AI agent with tools
- `tool(config)` - Define a tool for agent execution
- `dynamicTool(config)` - Define a dynamic tool for MCP, user-defined functions, or runtime-loaded tools
- `resource(config)` - Create an MCP resource
- `prompt(config)` - Create an MCP prompt template

### Provider Management

- `initializeProviders(config)` - Configure AI providers
- `getProvider(name)` - Get a specific provider
- `getProviderFromModel(modelString)` - Extract provider from model string

### Agent Composition

- `agentAsTool(agent)` - Convert agent to tool
- `createWorkflow(config)` - Multi-agent workflow orchestration
- `registerAgent(name, agent)` - Register agent in registry

### Memory

- `createMemory(type, config)` - Create memory strategy
- `ConversationMemory` - Store all messages
- `BufferMemory` - Keep last N messages
- `SummaryMemory` - Auto-summarize old messages

### MCP Server

- `createMCPServer(config)` - Create MCP server
- `discoverAll(config)` - Auto-discover tools/resources/prompts

### Production Features

- `rateLimitMiddleware(config)` - Rate limiting
- `cacheMiddleware(config)` - Response caching
- `costTrackingMiddleware(config)` - Usage tracking
- `securityMiddleware(config)` - Input/output validation

### AI SDK Integration

#### Re-exported Core Functions

These functions are re-exported from the `ai` package for convenience:

| Export                   | Description                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `generateText`           | Generate text from a model                                                                     |
| `streamText`             | Stream text generation                                                                         |
| `generateObject`         | Generate structured objects                                                                    |
| `streamObject`           | Stream structured object generation                                                            |
| `convertToModelMessages` | Convert UI messages to model-compatible format                                                 |
| `embed`                  | Generate single embeddings                                                                     |
| `embedMany`              | Batch embedding generation                                                                     |
| `aiTool`                 | AI SDK's type-safe tool helper (renamed from `tool` to avoid conflict with veryfront's `tool`) |
| `createIdGenerator`      | Generate consistent message IDs                                                                |
| `smoothStream`           | Smooth streaming output                                                                        |
| `cosineSimilarity`       | Vector similarity calculations                                                                 |

#### Experimental Functions

| Export                         | Description                  |
| ------------------------------ | ---------------------------- |
| `experimental_generateImage`   | Image generation             |
| `experimental_transcribe`      | Audio to text transcription  |
| `experimental_generateSpeech`  | Text to speech generation    |
| `experimental_createMCPClient` | MCP server connection client |

#### Provider Re-exports

| Export      | Description                                 |
| ----------- | ------------------------------------------- |
| `openai`    | OpenAI provider from `@ai-sdk/openai`       |
| `anthropic` | Anthropic provider from `@ai-sdk/anthropic` |

#### Adapter Utilities

- `useAISDK()` - Use AI SDK with Veryfront
- `aiSDKModel(provider, model)` - Create AI SDK model
- `toAISDKTools(tools)` - Convert Veryfront tools to AI SDK

### Platform

- `detectPlatform()` - Detect current runtime
- `getPlatformCapabilities()` - Get platform features
- `validatePlatformCompatibility(config)` - Check compatibility

## Dependencies

### Internal

- `@veryfront/types` - TypeScript types
- `@veryfront/utils` - Utilities (logging, caching)
- `@veryfront/config` - Configuration loading

### External

- `ai` - Vercel AI SDK (optional but recommended)
- `@ai-sdk/openai` - OpenAI provider for AI SDK
- `@ai-sdk/anthropic` - Anthropic provider for AI SDK
- `zod` - Schema validation for tools
- `react` (optional) - For React hooks and components

## Usage Examples

### Basic Agent

```typescript
import { agent, initializeProviders, tool } from "@veryfront/ai";
import { z } from "zod";

// Initialize providers
initializeProviders({
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
});

// Create a tool
const searchTool = tool({
  description: "Search the web for information",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    const results = await searchWeb(query);
    return JSON.stringify(results);
  },
});

// Create an agent
const myAgent = agent({
  model: "openai/gpt-4",
  system: "You are a helpful research assistant",
  tools: {
    search: searchTool,
  },
});

// Use the agent
const response = await myAgent.generate({
  input: "What is the latest news about AI?",
});

console.log(response.text);
```

### Dynamic Tools (MCP, User-Defined Functions)

```typescript
import { agent, dynamicTool } from "@veryfront/ai";
import { z } from "zod";

// Create a dynamic tool for MCP or user-defined functions
// where input/output types are unknown at compile time
const mcpTool = dynamicTool({
  id: "mcp-weather",
  description: "Get weather from MCP server",
  inputSchema: z.object({}), // Accepts any input
  execute: async (input) => {
    // Input is typed as 'unknown' - validate/cast at runtime
    const { location } = input as { location: string };
    return { temperature: 72, location };
  },
});

// Use with an agent
const myAgent = agent({
  model: "openai/gpt-4",
  system: "You are a weather assistant",
  tools: {
    weather: mcpTool,
  },
});

// Dynamic tools emit `dynamic: true` in streaming events
// and render as `dynamic-tool` type in useChat
```

### Agent with Memory

```typescript
import { agent, createMemory } from "@veryfront/ai";

const chatAgent = agent({
  model: "anthropic/claude-3-5-sonnet-20241022",
  system: "You are a friendly chatbot",
  memory: createMemory("conversation", {
    maxMessages: 100,
  }),
});

// First message
await chatAgent.generate({ input: "My name is Alice" });

// Second message - agent remembers
const response = await chatAgent.generate({ input: "What's my name?" });
// Response: "Your name is Alice"
```

### Multi-Agent Workflow

```typescript
import { agent, agentAsTool, createWorkflow } from "@veryfront/ai";

// Create specialized agents
const researcher = agent({
  model: "openai/gpt-4",
  system: "You are a research expert",
});

const writer = agent({
  model: "anthropic/claude-3-5-sonnet-20241022",
  system: "You are a content writer",
});

// Create workflow
const workflow = createWorkflow({
  steps: [
    {
      agent: researcher,
      input: "Research the topic",
    },
    {
      agent: writer,
      input: (prev) => `Write an article based on: ${prev.output}`,
    },
  ],
});

const result = await workflow.execute({
  initialInput: "AI trends in 2025",
});
```

### MCP Server

```typescript
import { createMCPServer, discoverAll } from "@veryfront/ai";

// Auto-discover tools, resources, and prompts
const discovered = await discoverAll({
  directories: ["./app/ai"],
});

// Create MCP server
const server = createMCPServer({
  name: "my-app",
  version: "1.0.0",
  tools: discovered.tools,
  resources: discovered.resources,
  prompts: discovered.prompts,
});

// Start server
await server.listen({ port: 3100 });
```

### Using AI SDK Re-exports

```typescript
import { aiTool, convertToModelMessages, cosineSimilarity, openai, streamText } from "veryfront/ai";
import { z } from "zod";

// Use AI SDK's streamText directly
export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages: convertToModelMessages(messages),
    tools: {
      weather: aiTool({
        description: "Get the weather for a location",
        parameters: z.object({
          location: z.string().describe("The location to get weather for"),
        }),
        execute: async ({ location }) => {
          return { temperature: 72, condition: "sunny", location };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}

// Use embeddings and similarity
import { embed, embedMany } from "veryfront/ai";

const { embedding } = await embed({
  model: openai.embedding("text-embedding-3-small"),
  value: "What is the meaning of life?",
});

const { embeddings } = await embedMany({
  model: openai.embedding("text-embedding-3-small"),
  values: ["Hello world", "Goodbye world"],
});

// Calculate similarity between embeddings
const similarity = cosineSimilarity(embedding, embeddings[0]);
```

### React Integration

```typescript
import { useChat } from "@veryfront/ai/react";

export function ChatComponent() {
  const { messages, input, setInput, sendMessage, isLoading } = useChat({
    agent: myAgent,
  });

  return (
    <div>
      <div>
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === "Enter" && sendMessage()}
      />
      {isLoading && <p>Loading...</p>}
    </div>
  );
}
```

### Production Features

```typescript
import {
  agent,
  cacheMiddleware,
  costTrackingMiddleware,
  rateLimitMiddleware,
  securityMiddleware,
} from "@veryfront/ai";

const productionAgent = agent({
  model: "openai/gpt-4",
  system: "You are a helpful assistant",
  middleware: [
    // Rate limiting: 10 requests per minute
    rateLimitMiddleware({
      strategy: "fixed-window",
      maxRequests: 10,
      windowMs: 60_000,
    }),

    // Response caching
    cacheMiddleware({
      strategy: "lru",
      maxSize: 1000,
      ttl: 3600_000, // 1 hour
    }),

    // Cost tracking
    costTrackingMiddleware({
      budgetLimit: 100, // $100
      alertThreshold: 0.8, // 80%
    }),

    // Security
    securityMiddleware({
      maxInputLength: 10000,
      blockPatterns: ["<script>", "eval("],
    }),
  ],
});
```

## Configuration

### Provider Setup

```typescript
// veryfront.config.ts
export default {
  ai: {
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORG_ID,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    },
    defaultModel: "openai/gpt-4",
    production: {
      rateLimit: {
        maxRequests: 100,
        windowMs: 60_000,
      },
      cache: {
        enabled: true,
        strategy: "lru",
      },
    },
  },
};
```

## Testing

```bash
# Run AI module tests
deno task test src/ai/

# Test agent execution
deno task test src/ai/agent/

# Test MCP server
deno task test src/ai/mcp/

# Run example
deno run --allow-net --allow-env examples/ai-basic/example.ts
```

## Performance

### Agent Response Times

- Basic completion: ~1-3 seconds
- With tool execution: ~2-5 seconds
- Multi-step reasoning: ~5-15 seconds
- Streaming: First token in ~200-500ms

### Cost Optimization

1. **Use caching**: Cache identical requests
2. **Choose cheaper models**: Use GPT-3.5 for simple tasks
3. **Limit context**: Use buffer/summary memory
4. **Batch requests**: Combine multiple queries

## Maintainer

**Team:** AI Team
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`react/`](../react/README.md) - React hooks integration
- [`server/`](../server/README.md) - Server integration
- [`security/`](../security/README.md) - Security validation

## Troubleshooting

### API Key Errors

```typescript
// Check provider initialization
import { getProvider } from "@veryfront/ai";

const provider = getProvider("openai");
if (!provider) {
  console.error("OpenAI provider not initialized");
}
```

### Rate Limiting

```typescript
// Handle rate limit errors
try {
  await agent.generate({ input: "..." });
} catch (error) {
  if (error.code === "RATE_LIMIT_EXCEEDED") {
    console.log("Rate limit exceeded, retry after:", error.retryAfter);
  }
}
```

### Memory Issues

```bash
# Increase Node.js/Deno memory
DENO_V8_FLAGS="--max-old-space-size=4096" deno run app.ts
```

### Platform Compatibility

```typescript
import { validatePlatformCompatibility } from "@veryfront/ai";

const warnings = validatePlatformCompatibility({
  mcpServer: true,
  streaming: true,
});

if (warnings.length > 0) {
  console.warn("Platform warnings:", warnings);
}
```

## References

- [MCP Protocol](https://modelcontextprotocol.io/)
- [Vercel AI SDK](https://sdk.vercel.ai/)
- [OpenAI API](https://platform.openai.com/docs)
- [Anthropic API](https://docs.anthropic.com/)
- [Veryfront AI Guide](https://veryfront.com/docs/ai)
