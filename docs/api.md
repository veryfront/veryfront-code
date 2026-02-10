# Veryfront Public API

> 18 flat, product-oriented import paths. Everything you need, nothing you don't.

```
npm install veryfront
```

---

## Overview

| Import Path | Purpose |
|---|---|
| `veryfront` | Server core, config, routing, data, validation |
| `veryfront/head` | `<Head>` component for document metadata |
| `veryfront/router` | Client-side routing and navigation |
| `veryfront/context` | Page context and frontmatter access |
| `veryfront/fonts` | Google Fonts loader |
| `veryfront/chat` | Chat UI components + hooks |
| `veryfront/markdown` | Markdown rendering component |
| `veryfront/mdx` | MDX provider and component overrides |
| `veryfront/agent` | Agent runtime, memory, composition |
| `veryfront/tool` | Tool definitions for agents |
| `veryfront/workflow` | Durable DAG-based workflows |
| `veryfront/prompt` | Prompt templates |
| `veryfront/resource` | Data resources for MCP |
| `veryfront/mcp` | Model Context Protocol server |
| `veryfront/middleware` | HTTP middleware pipeline |
| `veryfront/oauth` | OAuth 2.0 with 37 providers |
| `veryfront/provider` | AI provider abstraction |
| `veryfront/fs` | Filesystem and path utilities |

---

## `veryfront`

App primitives for server-rendered pages: configuration, server lifecycle, API routes, data loading, and input validation. Everything you need for a basic Veryfront app without AI.

### Configuration

```ts
import { defineConfig } from "veryfront";
import type { VeryfrontConfig } from "veryfront";

export default defineConfig({
  // your project config
});
```

### Environment

```ts
import { getEnv } from "veryfront";

const apiKey = getEnv("API_KEY");
```

### Server

```ts
import { createVeryfrontHandler, startVeryfrontServer } from "veryfront";
import type { StartVeryfrontServerOptions, VeryfrontServerHandle } from "veryfront";
```

### API Routes

```ts
import { json, badRequest, unauthorized, forbidden, serverError } from "veryfront";
import { apiNotFound, apiRedirect } from "veryfront";
import type { APIContext, APIHandler, APIResponse, APIRoute } from "veryfront";

export function GET(ctx: APIContext): APIResponse {
  return json({ message: "Hello" });
}
```

### Data Loading

```ts
import { notFound, redirect } from "veryfront";
import type { DataContext, PageWithData, InferGetServerDataProps, StaticPathsResult } from "veryfront";

export function getServerData(ctx: DataContext) {
  if (!ctx.params.id) throw notFound();
  return { title: "Page" };
}
```

### Input Validation

```ts
import {
  createValidatedHandler,
  CommonSchemas,
  parseJsonBody,
  parseFormData,
  parseQueryParams,
  sanitizeData,
  createValidationError,
  INPUT_VALIDATION_FAILED,
} from "veryfront";
import type { ValidatedHandlerConfig, ValidatedHandlerFunction } from "veryfront";
```

### Types

```ts
import type { MDXFrontmatter, PageContext } from "veryfront";
```

---

## `veryfront/head`

Document `<head>` metadata via a declarative React component.

```tsx
import { Head } from "veryfront/head";

export default function Page() {
  return (
    <>
      <Head>
        <title>My Page</title>
        <meta name="description" content="Page description" />
      </Head>
      <main>Content</main>
    </>
  );
}
```

---

## `veryfront/router`

Client-side routing, navigation, and links.

```tsx
import { RouterProvider, useRouter, Link } from "veryfront/router";
import type { RouterValue, RouterProviderProps, LinkProps } from "veryfront/router";

function Nav() {
  const router = useRouter();
  return (
    <nav>
      <Link href="/about">About</Link>
      <p>Current path: {router.pathname}</p>
    </nav>
  );
}
```

### `useRouter()` returns

| Property | Type | Description |
|---|---|---|
| `domain` | `string` | Current domain |
| `path` | `string` | Full path including query |
| `pathname` | `string` | Path without query |
| `params` | `Record<string, string>` | Route parameters |
| `query` | `Record<string, string>` | Query parameters |
| `isPreview` | `boolean` | Whether in preview mode |
| `isMounted` | `boolean` | Whether client-side mounted |
| `navigate(url)` | `(url: string) => Promise<void>` | Navigate to URL |
| `push(url)` | `(url: string) => Promise<void>` | Push to history |
| `replace(url)` | `(url: string) => Promise<void>` | Replace in history |
| `reload()` | `() => Promise<void>` | Reload current page |

---

## `veryfront/context`

Page context provider for accessing route info, params, and MDX frontmatter.

```tsx
import { PageContextProvider, usePageContext } from "veryfront/context";
import type { PageContextValue, MdxHeading } from "veryfront/context";

function TableOfContents() {
  const { headings, frontmatter } = usePageContext();
  return (
    <ul>
      {headings.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`}>{h.text}</a>
        </li>
      ))}
    </ul>
  );
}
```

---

## `veryfront/fonts`

Declarative Google Fonts loading.

```tsx
import { GoogleFonts } from "veryfront/fonts";
import type { Font, GoogleFontsProps } from "veryfront/fonts";

<GoogleFonts
  fonts={[
    { name: "Inter", weights: [400, 500, 700], variable: "--font-inter" },
    { name: "Fira Code", weights: [400], variable: "--font-mono" },
  ]}
/>
```

---

## `veryfront/chat`

Everything you need for conversational UIs in one import: components for rendering chat interfaces and hooks for managing chat state. This is the **client-side** counterpart to `veryfront/agent` (server-side runtime).

### Components

```tsx
import {
  Chat,
  ChatComponents,
  ChatHeader,
  ChatMessages,
  ChatInput,
  ChatFooter,
  Message,
  StreamingMessage,
  AgentCard,
  AIErrorBoundary,
  useAIErrorHandler,
} from "veryfront/chat";
```

#### `<Chat>`

Full chat interface with message list and input.

```tsx
import { Chat, useChat } from "veryfront/chat";

function ChatPage() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

#### `<AgentCard>`

Displays agent status, tool calls, thinking state, and messages.

```tsx
import { AgentCard, useAgent } from "veryfront/chat";

function AgentUI() {
  const agent = useAgent({ agent: "assistant" });
  return (
    <AgentCard
      status={agent.status}
      messages={agent.messages}
      toolCalls={agent.toolCalls}
      thinking={agent.thinking}
    />
  );
}
```

#### `<AIErrorBoundary>`

Error boundary for AI components with retry support.

```tsx
import { AIErrorBoundary } from "veryfront/chat";

<AIErrorBoundary
  fallback={(error, reset) => (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={reset}>Retry</button>
    </div>
  )}
>
  <Chat {...chat} />
</AIErrorBoundary>
```

### Hooks

```tsx
import {
  useChat,
  useAgent,
  useCompletion,
  useStreaming,
  useVoiceInput,
} from "veryfront/chat";
```

### Full-Stack Chat Pattern

The typical pattern connects a `useChat` hook to a file-based API route:

**Client** (`app/page.tsx`):
```tsx
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

**Server** (`app/api/chat/route.ts`):
```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  model: "openai/gpt-4o",
  system: "You are a helpful assistant.",
  tools: { search: true },
  memory: { type: "conversation" },
  streaming: true,
});

export async function POST(request: Request): Promise<Response> {
  const { messages } = await request.json();
  const result = await assistant.stream({ messages });
  return result.toDataStreamResponse();
}
```

`agent.stream()` returns an `AgentStreamResult` with `.toDataStreamResponse()` — a streaming SSE response compatible with the `useChat` hook.

| Hook | Purpose |
|---|---|
| `useChat` | Full chat state management with streaming |
| `useAgent` | Agent interaction with tool calls and status |
| `useCompletion` | Single-turn text completion |
| `useStreaming` | Low-level streaming response handling |
| `useVoiceInput` | Voice input via Web Speech API |

### Types

```ts
import type {
  ChatProps,
  MessageProps,
  StreamingMessageProps,
  AgentCardProps,
  AIErrorBoundaryProps,
  ChatTheme,
  AgentTheme,
  UseChatOptions,
  UseChatResult,
  UseAgentOptions,
  UseAgentResult,
  UseCompletionOptions,
  UseCompletionResult,
  UseStreamingOptions,
  UseStreamingResult,
  UseVoiceInputOptions,
  UseVoiceInputResult,
  UIMessage,
  UIMessagePart,
  ToolUIPart,
  DynamicToolUIPart,
  ToolState,
  ToolOutput,
  TextUIPart,
  ReasoningUIPart,
  ToolResultUIPart,
  OnToolCallArg,
} from "veryfront/chat";
```

---

## `veryfront/markdown`

Renders markdown strings at runtime with syntax highlighting and Mermaid diagram support. Used for displaying AI-generated content in chat interfaces.

```tsx
import { Markdown } from "veryfront/markdown";
import type { MarkdownProps, CodeBlockProps } from "veryfront/markdown";

<Markdown># Hello{"\n\n"}Some **bold** text with `code`.</Markdown>
```

---

## `veryfront/mdx`

MDX provider and component overrides for customizing how `.mdx` pages render.

```tsx
import { MDXProvider, useMDXComponents } from "veryfront/mdx";
import type { MDXProviderProps } from "veryfront/mdx";

// Override default MDX components
<MDXProvider components={{ h1: CustomH1, code: CustomCode, a: CustomLink }}>
  {children}
</MDXProvider>

// Access current MDX components in nested components
function MyComponent() {
  const components = useMDXComponents();
  return <div>{/* use components */}</div>;
}
```

---

## `veryfront/agent`

Define and run AI agents with memory, tool use, and multi-agent composition.

### Defining Agents

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful assistant.",
  tools: {
    search: searchTool,
    calculator: calculatorTool,
  },
  memory: { type: "conversation", maxMessages: 50 },
});
```

### Agent Runtime

```ts
import { AgentRuntime } from "veryfront/agent";
import type { AgentConfig, AgentResponse, AgentContext, AgentStatus } from "veryfront/agent";
```

### Memory

```ts
import {
  createMemory,
  createRedisMemory,
  BufferMemory,
  ConversationMemory,
  SummaryMemory,
  RedisMemory,
} from "veryfront/agent";
import type { Memory, MemoryPersistence, MemoryStats, RedisMemoryConfig } from "veryfront/agent";
```

### Multi-Agent Composition

```ts
import {
  registerAgent,
  getAgent,
  getAllAgentIds,
  agentAsTool,
  getAgentsAsTools,
  createWorkflow,
} from "veryfront/agent";
import type { WorkflowConfig, WorkflowStep, WorkflowResult } from "veryfront/agent";

// Register agents and expose them as tools to other agents
registerAgent(researcher);
registerAgent(writer);
const tools = getAgentsAsTools(["researcher", "writer"]);
```

### Types

```ts
import type {
  Agent,
  AgentMessage,     // preferred
  Message,          // deprecated alias
  MessagePart,
  ToolCall,
  StreamToolCall,
  ToolCallPart,
  ToolCallPartWithArgs,
  ToolCallPartWithInput,
  ToolResultPart,
  AgentMiddleware,
  AgentStreamResult,
  EdgeConfig,
  MemoryConfig,
  ModelProvider,
  ModelString,
} from "veryfront/agent";

import { getTextFromParts, getToolArguments, hasArgs, hasInput } from "veryfront/agent";
```

---

## `veryfront/tool`

Define tools that agents can call. Tools registered via `tool()` are automatically discoverable by the agent runtime and MCP server through `toolRegistry`.

```ts
import { tool, dynamicTool, executeTool, toolRegistry } from "veryfront/tool";
import type { Tool, ToolConfig, ToolDefinition, ToolExecutionContext, DynamicToolConfig, JsonSchema } from "veryfront/tool";
import { z } from "zod";

const searchTool = tool({
  id: "search",
  description: "Search the web",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    return { results: await search(query) };
  },
});
```

---

## `veryfront/workflow`

Durable, DAG-based workflows with human-in-the-loop approval.

### Defining Workflows

```ts
import {
  workflow,
  step,
  agentStep,
  toolStep,
  sequence,
  parallel,
  branch,
  dag,
  when,
  unless,
  loop,
  times,
  doWhile,
  map,
  delay,
  dependsOn,
  subWorkflow,
  waitForApproval,
  waitForEvent,
} from "veryfront/workflow";

const pipeline = workflow({
  id: "data-pipeline",
  steps: [
    agentStep("extract", "extractor"),
    branch("route-by-size", {
      condition: (ctx) => Boolean(ctx.data?.largeInput),
      then: [
        parallel("chunk-processing", [
          agentStep("chunk-1", "processor"),
          agentStep("chunk-2", "processor"),
        ]),
      ],
      else: [agentStep("process", "processor")],
    }),
    waitForApproval("approval", { approvers: ["admin"] }),
    agentStep("publish", "publisher"),
  ],
});
```

### Backends

```ts
import { MemoryBackend, RedisBackend } from "veryfront/workflow";
import type { WorkflowBackend, BackendConfig, RedisBackendConfig, RedisAdapter } from "veryfront/workflow";
```

### Client

```ts
import { createWorkflowClient, WorkflowClient } from "veryfront/workflow";
import type { WorkflowClientConfig } from "veryfront/workflow";

const client = createWorkflowClient();
client.register(pipeline);
const handle = await client.start("data-pipeline", { input: data });
const result = await handle.result();
```

### React Hooks

```tsx
import {
  useWorkflow,
  useWorkflowList,
  useWorkflowStart,
  useApproval,
} from "veryfront/workflow";

function WorkflowDashboard() {
  const { runs } = useWorkflowList({ workflowId: "data-pipeline" });
  const { start } = useWorkflowStart({ workflowId: "data-pipeline" });
  return (
    <div>
      <button onClick={() => start({ input: data })}>Run Pipeline</button>
      {runs.map((run) => (
        <div key={run.id}>{run.status}</div>
      ))}
    </div>
  );
}
```

### Advanced: Direct Executor Access

For custom execution environments (e.g., standalone scripts, CI pipelines), use the internal subpaths:

```ts
// Direct workflow execution (not via HTTP client)
import { WorkflowExecutor } from "veryfront/workflow/executor";

// Blob storage for large workflow data (S3, GCS, local)
import { S3BlobStorage } from "veryfront/workflow/blob";

// Agent/tool registries for step execution
import { DefaultAgentRegistry, DefaultToolRegistry } from "veryfront/workflow/runtime";
```

> Most apps should use `veryfront/workflow` (DSL + client + hooks). The subpaths are for infrastructure code that runs workflows outside the framework server.

### Types

```ts
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStatus,
  Workflow,
  WorkflowOptions,
  StepOptions,
  BranchOptions,
  LoopOptions,
  MapOptions,
  ParallelOptions,
  SubWorkflowOptions,
  WaitForApprovalOptions,
  WaitForEventOptions,
} from "veryfront/workflow";
```

---

## `veryfront/prompt`

Reusable prompt templates. Prompts registered via `prompt()` are automatically discoverable by the MCP server through `promptRegistry`.

```ts
import { prompt, promptRegistry } from "veryfront/prompt";
import type { Prompt, PromptConfig } from "veryfront/prompt";

const summarize = prompt({
  id: "summarize",
  description: "Summarize text in a chosen style",
  content: "Summarize the following text in {style} style:\n\n{text}",
});
```

---

## `veryfront/resource`

Data resources for MCP servers. Resources registered via `resource()` are automatically discoverable by the MCP server through `resourceRegistry`.

```ts
import { resource, resourceRegistry } from "veryfront/resource";
import type { Resource, ResourceConfig } from "veryfront/resource";
import { z } from "zod";

const docs = resource({
  pattern: "docs/:section",
  description: "API documentation",
  paramsSchema: z.object({
    section: z.string(),
  }),
  load: async ({ section }) => {
    return { content: await readDocs(section) };
  },
});
```

---

## `veryfront/mcp`

Model Context Protocol server for exposing tools, prompts, and resources to AI clients.

```ts
import { createMCPServer, MCPServer, registerTool, registerPrompt, registerResource } from "veryfront/mcp";
import type { MCPServerConfig, MCPStats, MCPTool } from "veryfront/mcp";

const server = createMCPServer({
  enabled: true,
  auth: { type: "none" },
  cors: { enabled: true, origins: ["*"] },
});

// Tools, prompts, resources registered via their own modules
// are automatically discovered. Or register manually:
registerTool(myTool.id, myTool);
registerPrompt(myPrompt.id, myPrompt);
registerResource(myResource.id, myResource);
```

---

## `veryfront/middleware`

HTTP middleware pipeline with built-in middleware for common patterns.

### Pipeline

```ts
import { MiddlewareContext, MiddlewarePipeline } from "veryfront/middleware";
import type { Context, ExecutionContext, MiddlewareFactory, MiddlewareHandler, Next } from "veryfront/middleware";
```

### Built-in Middleware

```ts
import { cors, rateLimit, logger, timeout } from "veryfront/middleware";

// CORS
cors({ origin: "https://example.com", methods: ["GET", "POST"] });

// Rate limiting
rateLimit({ maxRequests: 100, windowMs: 60_000 });

// Rate limiting with Redis
import { RedisRateLimitStore } from "veryfront/middleware";
rateLimit({
  maxRequests: 100,
  windowMs: 60_000,
  store: new RedisRateLimitStore({ /* redis config */ }),
});

// Logging
logger({ format: "combined" });

// Timeout
timeout({ timeoutMs: 30_000 });
```

### Types

```ts
import type {
  CorsOptions,
  RateLimitOptions,
  RateLimitStore,
  RedisRateLimitOptions,
  LogFormat,
  LoggerOptions,
  TimeoutOptions,
  MiddlewarePipelineOptions,
} from "veryfront/middleware";
```

---

## `veryfront/oauth`

OAuth 2.0 with handler factories and 37 pre-configured providers.

### Handler Factories

```ts
import {
  createOAuthInitHandler,
  createOAuthCallbackHandler,
  createOAuthStatusHandler,
  createOAuthDisconnectHandler,
} from "veryfront/oauth";
import type { OAuthInitHandlerOptions, OAuthCallbackHandlerOptions } from "veryfront/oauth";
```

### Providers

37 pre-configured OAuth providers:

```ts
import {
  githubConfig,
  calendarConfig,
  slackConfig,
  notionConfig,
  linearConfig,
  figmaConfig,
  discordConfig,
  // ... and 30 more
} from "veryfront/oauth";
```

<details>
<summary>All 37 providers</summary>

`airtableConfig`, `asanaConfig`, `bitbucketConfig`, `boxConfig`, `calendarConfig`, `clickupConfig`, `confluenceConfig`, `discordConfig`, `driveConfig`, `dropboxConfig`, `figmaConfig`, `freshdeskConfig`, `githubConfig`, `gitlabConfig`, `gmailConfig`, `hubspotConfig`, `intercomConfig`, `jiraConfig`, `linearConfig`, `mailchimpConfig`, `mondayConfig`, `notionConfig`, `oneDriveConfig`, `outlookConfig`, `pipedriveConfig`, `quickbooksConfig`, `salesforceConfig`, `sharePointConfig`, `sheetsConfig`, `shopifyConfig`, `slackConfig`, `teamsConfig`, `trelloConfig`, `twitterConfig`, `webexConfig`, `xeroConfig`, `zoomConfig`

</details>

### Token Storage

```ts
import { MemoryTokenStore } from "veryfront/oauth";
import type { TokenStore } from "veryfront/oauth";

// In-memory (development)
const store = new MemoryTokenStore();

// Implement TokenStore for production (Redis, database, etc.)
```

### Example Setup

```ts
import { createOAuthInitHandler, createOAuthCallbackHandler, githubConfig, MemoryTokenStore } from "veryfront/oauth";

const tokenStore = new MemoryTokenStore();

export const GET = createOAuthInitHandler(githubConfig, { tokenStore });
export const GET_CALLBACK = createOAuthCallbackHandler(githubConfig, { tokenStore });
```

### Types

```ts
import type {
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  AuthorizationUrlOptions,
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "veryfront/oauth";
```

---

## `veryfront/provider`

AI provider abstraction layer for OpenAI, Anthropic, and Google.

```ts
import { getProvider, getProviderFromModel, initializeProviders } from "veryfront/provider";
import type { Provider, ProviderConfig, ProvidersConfig } from "veryfront/provider";

// Initialize providers (typically in config or startup)
initializeProviders({
  openai: { apiKey: getEnv("OPENAI_API_KEY") },
  anthropic: { apiKey: getEnv("ANTHROPIC_API_KEY") },
  google: { apiKey: getEnv("GOOGLE_API_KEY") },
});

// Get a provider by name
const provider = getProvider("openai");

// Get a provider from a model string
const resolved = getProviderFromModel("openai/gpt-4o"); // { provider, model }
```

### Provider Classes

```ts
import { BaseProvider, OpenAIProvider, AnthropicProvider, GoogleProvider } from "veryfront/provider";
import type { OpenAIConfig, AnthropicConfig, GoogleConfig, CompletionRequest, CompletionResponse } from "veryfront/provider";
```

---

## `veryfront/fs`

Cross-runtime filesystem operations and path utilities.

### File Operations

```ts
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  remove,
  readDir,
  createFileSystem,
  cwd,
} from "veryfront/fs";
import type { FileSystem } from "veryfront/fs";

const content = await readTextFile("./data/config.json");
await writeTextFile("./output/result.json", JSON.stringify(data));
await mkdir("./output", { recursive: true });

if (await exists("./cache")) {
  await remove("./cache", { recursive: true });
}

for await (const entry of readDir("./pages")) {
  console.log(entry.name, entry.isFile);
}
```

### Path Utilities

```ts
import { join, resolve, dirname, basename, extname } from "veryfront/fs";

const filePath = join("src", "pages", "index.tsx");
const dir = dirname(filePath);          // "src/pages"
const name = basename(filePath);        // "index.tsx"
const ext = extname(filePath);          // ".tsx"
const abs = resolve("src", "pages");    // absolute path
```

### Project Context

```ts
import { cwd } from "veryfront/fs";

const projectRoot = cwd();
```
