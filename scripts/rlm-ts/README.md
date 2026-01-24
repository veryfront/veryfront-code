# RLM-TS - Recursive Language Model

A production-grade TypeScript implementation of Recursive Language Models for agentic AI applications with code execution capabilities.

## Overview

RLM (Recursive Language Model) is an approach where an LLM iteratively solves problems by:

1. Receiving a query
2. Generating reasoning and code
3. Executing code in a sandboxed environment
4. Observing results
5. Repeating until reaching a final answer

This enables complex multi-step reasoning, data processing, and dynamic problem-solving that single-shot LLM calls cannot achieve.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic Claude, Google Gemini, Azure OpenAI, Ollama, OpenRouter, Groq, Together, Fireworks
- **Sandboxed Execution**: Safe JavaScript code execution with controlled globals
- **Streaming Support**: Stream responses as they're generated
- **Nested Queries**: LLM can call itself recursively for sub-problems
- **Context Injection**: Pass data (strings, arrays, objects, Maps) to the execution environment
- **Token Tracking**: Detailed usage statistics across iterations
- **Configurable**: Max iterations, depth limits, timeouts, custom system prompts
- **Type-Safe**: Full TypeScript with comprehensive type definitions

## Installation

```typescript
// Deno
import { createRLM } from "https://deno.land/x/rlm_ts/src/index.ts";

// Or import from local path
import { createRLM } from "./scripts/rlm-ts/src/index.ts";
```

## Quick Start

```typescript
import { createRLM } from "./src/index.ts";

const rlm = createRLM({
  backend: "openai",
  backendConfig: {
    apiKey: Deno.env.get("OPENAI_API_KEY")!,
    model: "gpt-4o",
  },
});

const result = await rlm.completion({
  query: "What is the sum of the first 100 prime numbers?",
});

console.log(result.finalAnswer);
console.log(`Completed in ${result.iterationCount} iterations`);
console.log(`Total tokens: ${result.usage.totalTokens.totalTokens}`);
```

## Usage

### Basic Completion

```typescript
import { createRLM } from "./src/index.ts";

const rlm = createRLM({
  backend: "anthropic",
  backendConfig: {
    apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    model: "claude-sonnet-4-20250514",
  },
  maxIterations: 10,
  maxDepth: 5,
  verbose: true,
});

const result = await rlm.completion({
  query: "Analyze the data and find the top 3 users by score",
  context: {
    users: [
      { name: "Alice", score: 95 },
      { name: "Bob", score: 87 },
      { name: "Charlie", score: 92 },
      { name: "Diana", score: 88 },
    ],
  },
});

if (result.success) {
  console.log("Answer:", result.finalAnswer);
} else {
  console.error("Error:", result.error?.message);
}
```

### Streaming

```typescript
const rlm = createRLM({
  backend: "openai",
  backendConfig: {
    apiKey: Deno.env.get("OPENAI_API_KEY")!,
    model: "gpt-4o",
  },
});

for await (const chunk of rlm.stream({ query: "Explain recursion with examples" })) {
  switch (chunk.type) {
    case "text":
      process.stdout.write(chunk.content);
      break;
    case "code_start":
      console.log("\n--- Executing Code ---");
      break;
    case "execution":
      console.log("Output:", chunk.executionResult?.output.stdout);
      break;
    case "final_answer":
      console.log("\n\nFinal Answer:", chunk.content);
      break;
  }
}
```

### With Context Data

```typescript
// String context
const result1 = await rlm.completion({
  query: "Count the words in the text",
  context: "Hello world, this is a test string.",
});

// Array context
const result2 = await rlm.completion({
  query: "Calculate the average",
  context: [10, 20, 30, 40, 50],
});

// Object context
const result3 = await rlm.completion({
  query: "Process the user data",
  context: {
    users: [...],
    settings: {...},
  },
});

// Map context (for multiple named variables)
const context = new Map();
context.set("data", [...]);
context.set("config", {...});
const result4 = await rlm.completion({
  query: "Use data and config",
  context,
});
```

### Conversation History

```typescript
const result = await rlm.completion({
  query: "Now filter for users over 18",
  conversationHistory: {
    messages: [
      { role: "user", content: "Load the user database" },
      { role: "assistant", content: "I've loaded 1000 users into the context." },
    ],
  },
});
```

### Custom System Prompt

```typescript
const rlm = createRLM({
  backend: "openai",
  backendConfig: { ... },
  systemPrompt: `You are a data analysis expert.

When given a dataset, you should:
1. Explore the data structure
2. Identify patterns
3. Generate insights
4. Provide visualizations when helpful

Always use code to process data. End with FINAL ANSWER: followed by your conclusions.`,
});
```

### Event Callbacks

```typescript
const rlm = createRLM({
  backend: "anthropic",
  backendConfig: { ... },
  onIteration: async (iteration) => {
    console.log(`Iteration ${iteration.index}:`);
    console.log(`  Response length: ${iteration.response.length}`);
    console.log(`  Code blocks: ${iteration.parsedResponse.codeBlocks.length}`);
  },
  onCodeExecution: async (code, result) => {
    console.log("Executed:", code.substring(0, 50));
    console.log("Success:", result.success);
  },
  onNestedCall: async (call) => {
    console.log(`Nested call at depth ${call.depth}: ${call.query}`);
  },
});
```

## Configuration

### RLMConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backend` | `ClientBackend` | required | LLM provider to use |
| `backendConfig` | `LLMClientConfig` | required | Provider-specific configuration |
| `maxIterations` | `number` | 10 | Maximum reasoning iterations |
| `maxDepth` | `number` | 5 | Maximum recursion depth for nested calls |
| `maxExecutionTimeMs` | `number` | 300000 | Total execution timeout (5 min) |
| `systemPrompt` | `string` | (built-in) | Custom system prompt |
| `verbose` | `boolean` | false | Enable verbose logging |
| `environment` | `EnvironmentConfig` | local | Execution environment config |
| `traceId` | `string` | auto | Custom trace ID for correlation |
| `onIteration` | `function` | - | Callback after each iteration |
| `onCodeExecution` | `function` | - | Callback after code execution |
| `onNestedCall` | `function` | - | Callback for nested LLM calls |

### LLMClientConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | API key for the provider |
| `model` | `string` | required | Model identifier |
| `baseUrl` | `string` | provider default | Custom API endpoint |
| `temperature` | `number` | - | Sampling temperature |
| `maxTokens` | `number` | 4096 | Max output tokens |
| `topP` | `number` | - | Nucleus sampling |
| `stopSequences` | `string[]` | - | Stop sequences |
| `timeout` | `number` | - | Request timeout (ms) |
| `retries` | `number` | 3 | Max retry attempts |
| `retryDelay` | `number` | 1000 | Initial retry delay (ms) |

## Supported Backends

### OpenAI / OpenAI-Compatible

```typescript
// OpenAI
createRLM({
  backend: "openai",
  backendConfig: {
    apiKey: "sk-...",
    model: "gpt-4o",
  },
});

// OpenRouter
createRLM({
  backend: "openrouter",
  backendConfig: {
    apiKey: "sk-or-...",
    model: "anthropic/claude-3-opus",
  },
});

// Groq
createRLM({
  backend: "groq",
  backendConfig: {
    apiKey: "gsk_...",
    model: "llama-3.1-70b-versatile",
  },
});

// Together AI
createRLM({
  backend: "together",
  backendConfig: {
    apiKey: "...",
    model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  },
});

// Fireworks AI
createRLM({
  backend: "fireworks",
  backendConfig: {
    apiKey: "...",
    model: "accounts/fireworks/models/llama-v3p1-70b-instruct",
  },
});
```

### Anthropic Claude

```typescript
createRLM({
  backend: "anthropic",
  backendConfig: {
    apiKey: "sk-ant-...",
    model: "claude-sonnet-4-20250514",
  },
});
```

### Google Gemini

```typescript
createRLM({
  backend: "gemini",
  backendConfig: {
    apiKey: "...",
    model: "gemini-1.5-pro",
  },
});
```

### Azure OpenAI

```typescript
import { AzureOpenAIConfig } from "./src/clients/azure.ts";

createRLM({
  backend: "azure_openai",
  backendConfig: {
    apiKey: "...",
    model: "gpt-4o",
    resourceName: "my-resource",
    deploymentName: "my-deployment",
    apiVersion: "2024-02-15-preview",
  } as AzureOpenAIConfig,
});
```

### Ollama (Local)

```typescript
createRLM({
  backend: "ollama",
  backendConfig: {
    model: "llama3.2",
    baseUrl: "http://localhost:11434", // default
  },
});
```

## Execution Environment

The sandboxed JavaScript environment provides:

### Available Globals
- Primitives: `undefined`, `NaN`, `Infinity`
- Types: `Object`, `Array`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Date`, `RegExp`, `Error`, `TypeError`, `RangeError`, `SyntaxError`
- Functions: `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`, `encodeURIComponent`, `decodeURI`, `decodeURIComponent`
- JSON: `JSON.parse`, `JSON.stringify`
- Math: Full `Math` object
- Promises: `Promise`
- Console: `console.log`, `console.info`, `console.warn`, `console.error`, `console.debug`
- Utilities: `structuredClone`

### Blocked Globals
- `eval`, `Function` (code injection)
- `Deno`, `process`, `require`, `module`, `exports` (runtime access)
- `globalThis`, `window`, `self` (global scope)
- `fetch`, `XMLHttpRequest`, `WebSocket` (network)
- `Worker`, `SharedWorker`, `importScripts` (threading)
- `setTimeout`, `setInterval`, `setImmediate` (timers)

### Nested LLM Calls

Code can call the LLM recursively:

```javascript
// Inside executed code
const answer = await llm_query("What is the capital of France?");
console.log(answer); // "Paris"

// Also available as rlm_query
const result = await rlm_query("Explain this concept");
```

## Response Format

```typescript
interface RLMCompletionResult {
  success: boolean;
  response: string;           // Last LLM response
  finalAnswer?: string;       // Extracted final answer
  iterations: RLMIteration[]; // All iteration details
  iterationCount: number;
  contextMetadata: ContextMetadata;
  usage: UsageSummary;        // Token usage stats
  totalTimeMs: number;
  traceId: string;
  config: RLMConfig;
  error?: RLMError;
  warnings: string[];
}

interface UsageSummary {
  models: Map<string, ModelUsage>;
  totalCalls: number;
  totalTokens: TokenUsage;
  totalLatencyMs: number;
}
```

## Error Handling

```typescript
import { RLMError } from "./src/index.ts";

const result = await rlm.completion({ query: "..." });

if (!result.success) {
  const error = result.error;
  console.error(`Error [${error?.code}]: ${error?.message}`);

  // Error codes:
  // - EXECUTION_ERROR: Code execution failed
  // - TIMEOUT: Execution time exceeded
  // - MAX_ITERATIONS: Hit iteration limit
  // - MAX_DEPTH: Recursion depth exceeded
  // - PARSE_ERROR: Failed to parse response
  // - API_ERROR: LLM API error
  // - UNKNOWN: Unexpected error
}
```

## Logging

```typescript
import { createLogger, createRLM } from "./src/index.ts";

// Create custom logger
const logger = createLogger({
  level: "debug",     // debug | info | warn | error | silent
  format: "json",     // json | pretty
  output: (entry) => {
    // Custom output handler
    myLoggingService.log(entry);
  },
});

// Use with RLM
const rlm = createRLM({
  backend: "openai",
  backendConfig: { ... },
  verbose: true, // Enables built-in logging
});
```

## Development

```bash
# Type check
deno task check

# Run tests
deno task test

# Lint
deno task lint

# Format
deno task fmt

# Run example
deno task example
```

## Architecture

```
rlm-ts/
├── src/
│   ├── index.ts           # Main exports
│   ├── types.ts           # Type definitions
│   ├── core/
│   │   ├── rlm.ts         # Main RLM orchestration
│   │   ├── parser.ts      # Response parsing
│   │   └── logger.ts      # Logging utilities
│   ├── clients/
│   │   ├── base.ts        # Abstract base client
│   │   ├── openai.ts      # OpenAI/compatible
│   │   ├── anthropic.ts   # Anthropic Claude
│   │   ├── gemini.ts      # Google Gemini
│   │   ├── azure.ts       # Azure OpenAI
│   │   └── ollama.ts      # Local Ollama
│   └── environments/
│       └── local.ts       # JavaScript sandbox
├── examples/
│   └── basic.ts           # Usage examples
├── tests/
│   └── ...                # Test files
├── deno.json              # Deno configuration
└── README.md              # This file
```

## License

MIT

## Credits

TypeScript port inspired by [alexzhang13/rlm](https://github.com/alexzhang13/rlm).
