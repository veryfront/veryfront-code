#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Generate Markdown API reference pages from barrel JSDoc and `deno doc --json`.
 *
 * Reads `deno.json` exports, extracts @module/@example JSDoc from each barrel,
 * runs `deno doc --json` for type information, and outputs one `.md` file per
 * export path.
 *
 * Usage: deno task docs
 *        deno task docs -- --output ../../docs/docs/code/api-reference
 */

import { parseArgs } from "jsr:@std/cli/parse-args";
import { ensureDir } from "jsr:@std/fs/ensure-dir";
import { COMMANDS } from "../../cli/help/command-definitions.ts";
import type { CommandCategory, CommandHelp } from "../../cli/help/types.ts";

const ROOT = Deno.cwd();

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = parseArgs(Deno.args, {
  string: ["output", "source-base-url"],
  default: {
    output: "docs/api-reference",
    "source-base-url": "https://github.com/veryfront/veryfront-code/blob/main",
  },
});

const OUTPUT_DIR = args.output.startsWith("/")
  ? args.output
  : `${ROOT}/${args.output}`;
const VERYFRONT_DIR = `${OUTPUT_DIR}/veryfront`;
const SOURCE_BASE_URL = String(args["source-base-url"]).replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportEntry {
  /** e.g. "." or "./agent" */
  exportPath: string;
  /** e.g. "veryfront" or "veryfront/agent" */
  importPath: string;
  /** Short name for the file, e.g. "index" (root) or "agent" */
  slug: string;
  /** Relative TS file path, e.g. "./src/agent/index.ts". Empty for synthetic parents. */
  filePath: string;
  /** True when no concrete top-level export exists (e.g. `channels`). */
  isSynthetic?: boolean;
  /** Curated description used when no barrel JSDoc is available. */
  syntheticDescription?: string;
}

interface DeepImport {
  /** e.g. "./agent/testing" or "./channels/control-plane" */
  exportPath: string;
  /** e.g. "veryfront/agent/testing" */
  importPath: string;
  /** Sub-path under the parent, e.g. "testing" or "claude-code/react" */
  subSlug: string;
  /** Relative TS file path */
  filePath: string;
}

interface ModuleGroup {
  parent: ExportEntry;
  deepImports: DeepImport[];
}

interface BarrelJSDoc {
  description: string;
  moduleName: string;
  examples: Array<{ title: string; code: string }>;
}

interface TsType {
  repr: string;
  kind: string;
  keyword?: string;
  typeRef?: { typeName: string; typeParams?: TsType[] | null };
  union?: TsType[];
  intersection?: TsType[];
  array?: TsType;
  fnOrConstructor?: {
    constructor: boolean;
    params: Array<{ name: string; optional?: boolean; tsType?: TsType }>;
    tsType: TsType;
    typeParams?: unknown[];
  };
  typeLiteral?: {
    properties: InterfaceProperty[];
    callSignatures?: unknown[];
    indexSignatures?: unknown[];
    constructors?: unknown[];
    methods?: unknown[];
  };
  parenthesized?: TsType;
  literal?: {
    kind: string;
    boolean?: boolean;
    string?: string;
    number?: number;
  };
  this?: boolean;
  tuple?: TsType[];
  indexedAccess?: { objType: TsType; indexType: TsType };
  mapped?: unknown;
  conditional?: unknown;
  infer?: unknown;
  typeOperator?: { operator: string; tsType: TsType };
  rest?: TsType;
  optional?: TsType;
}

interface FunctionParam {
  kind: string;
  name: string;
  optional?: boolean;
  tsType?: TsType;
}

interface FunctionDef {
  params: FunctionParam[];
  returnType?: TsType;
  hasBody: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  typeParams?: Array<{ name: string; default?: TsType }>;
}

interface InterfaceProperty {
  name: string;
  optional: boolean;
  tsType?: TsType;
  jsDoc?: { doc?: string };
  params?: unknown[];
  typeParams?: unknown[];
  location?: DenoDocLocation;
}

interface InterfaceMethod {
  name: string;
  kind: string;
  optional: boolean;
  params: FunctionParam[];
  returnType?: TsType;
  typeParams?: unknown[];
  jsDoc?: { doc?: string };
}

interface InterfaceDef {
  extends: unknown[];
  constructors: unknown[];
  methods: InterfaceMethod[];
  properties: InterfaceProperty[];
}

interface ClassMethod {
  accessibility: string | null;
  optional: boolean;
  isAbstract: boolean;
  isStatic: boolean;
  name: string;
  kind: string;
  functionDef: FunctionDef;
  jsDoc?: { doc?: string };
}

interface ClassDef {
  constructors: Array<{ params: FunctionParam[]; jsDoc?: { doc?: string } }>;
  methods: ClassMethod[];
  properties: Array<
    {
      name: string;
      optional: boolean;
      tsType?: TsType;
      accessibility?: string | null;
      isStatic?: boolean;
      jsDoc?: { doc?: string };
    }
  >;
  extends?: unknown;
  implements?: unknown[];
  typeParams?: unknown[];
}

interface DocNode {
  name: string;
  kind: string;
  jsDoc?: { doc?: string };
  functionDef?: FunctionDef;
  interfaceDef?: InterfaceDef;
  typeAliasDef?: { tsType?: TsType };
  classDef?: ClassDef;
  variableDef?: Record<string, unknown>;
  enumDef?: Record<string, unknown>;
  location?: DenoDocLocation;
  referenceTarget?: DenoDocLocation;
}

interface DenoDocSymbol {
  name: string;
  declarations?: Array<Record<string, unknown>>;
}

interface DenoDocLocation {
  filename?: string;
  line?: number;
  col?: number;
  byteIndex?: number;
}

interface ExportSummary {
  name: string;
  description: string;
  sourceHref: string;
}

interface CategorizedExports {
  functions: ExportSummary[];
  types: ExportSummary[];
  classes: ExportSummary[];
  constants: ExportSummary[];
  components: ExportSummary[];
}

interface SourceDocStats {
  total: number;
  documented: number;
  missing: number;
}

const EMPTY_BARREL_JSDOC: BarrelJSDoc = {
  description: "",
  moduleName: "",
  examples: [],
};

// ---------------------------------------------------------------------------
// Curated import snippets: show the most representative imports per module
// ---------------------------------------------------------------------------

const IMPORT_PRIORITY: Record<string, string[]> = {
  "veryfront": [
    "defineConfig",
    "json",
    "notFound",
    "redirect",
    "getEnv",
    "createValidatedHandler",
  ],
  "veryfront/head": ["Head"],
  "veryfront/router": ["useRouter", "Link", "RouterProvider"],
  "veryfront/context": ["usePageContext", "PageContextProvider"],
  "veryfront/fonts": ["GoogleFonts"],
  "veryfront/chat": [
    "Chat",
    "useChat",
    "useAgent",
    "AgentCard",
    "Message",
    "AIErrorBoundary",
  ],
  "veryfront/markdown": ["Markdown"],
  "veryfront/mdx": ["MDXProvider", "useMDXComponents"],
  "veryfront/agent": [
    "agent",
    "AgentRuntime",
    "registerAgent",
    "getAgentsAsTools",
    "createMemory",
  ],
  "veryfront/tool": [
    "tool",
    "dynamicTool",
    "loadRemoteToolsFromSource",
    "toolRegistry",
  ],
  "veryfront/workflow": [
    "workflow",
    "step",
    "parallel",
    "branch",
    "waitForApproval",
    "createWorkflowClient",
  ],
  "veryfront/prompt": ["prompt", "promptRegistry"],
  "veryfront/resource": ["resource", "resourceRegistry"],
  "veryfront/mcp": [
    "createMCPServer",
    "registerTool",
    "registerPrompt",
    "registerResource",
  ],
  "veryfront/middleware": [
    "cors",
    "rateLimit",
    "logger",
    "timeout",
    "MiddlewarePipeline",
  ],
  "veryfront/oauth": [
    "createOAuthInitHandler",
    "createOAuthCallbackHandler",
    "githubConfig",
    "MemoryTokenStore",
  ],
  "veryfront/provider": [
    "registerModelProvider",
    "resolveModel",
    "hasModelProvider",
    "getRegisteredModelProviders",
  ],
  "veryfront/fs": [
    "readTextFile",
    "writeTextFile",
    "join",
    "resolve",
    "exists",
    "mkdir",
  ],
  // CLI is an executable entry point, not an importable module. Skip import snippet.
  "veryfront/cli": [],
};

// ---------------------------------------------------------------------------
// Curated fallback descriptions for exports missing JSDoc upstream
// ---------------------------------------------------------------------------

const DESCRIPTIONS: Record<string, Record<string, string>> = {
  "veryfront": {
    defineConfig: "Define project configuration",
    getEnv: "Read environment variable (typed)",
    createHandler: "Create HTTP request handler",
    startServer: "Start server (dev or production)",
    json: "JSON response helper",
    badRequest: "400 Bad Request response",
    unauthorized: "401 Unauthorized response",
    forbidden: "403 Forbidden response",
    serverError: "500 Internal Server Error response",
    apiNotFound: "404 Not Found response",
    apiRedirect: "Redirect response",
    notFound: "Throw 404 in data loaders",
    redirect: "Throw redirect in data loaders",
    createValidatedHandler: "Zod-validated API handler wrapper",
    parseJsonBody: "Parse and validate JSON body",
    parseFormData: "Parse multipart form data",
    parseQueryParams: "Parse and validate query params",
    sanitizeData:
      "Sanitize data to prevent XSS and prototype pollution attacks",
    createValidationError: "Create an input validation error.",
    CommonSchemas: "Built-in Zod schemas (email, URL, etc.)",
    INPUT_VALIDATION_FAILED:
      "HTTP request input validation failures (replaces ValidationError)",
    APIContext: "API route handler context",
    APIHandler: "API route handler signature",
    APIResponse: "API handler response type",
    APIRoute: "Route with method handlers",
    DataContext: "`getServerData` context",
    InferGetServerDataProps: "Infer props from `getServerData`",
    PageWithData: "Page with server data props",
    StaticPathsResult: "`getStaticPaths` return type",
    MDXFrontmatter: "Parsed MDX frontmatter",
    PageContext: "Page runtime context",
    StartServerOptions: "Server options (dev with HMR or production)",
    VeryfrontConfig: "Project configuration shape",
    VeryfrontHandler:
      "Web API request handler with WebSocket upgrade and HMR helpers",
    VeryfrontServer: "Running server instance with lifecycle controls",
    toNodeHandler:
      "Convert a Web API request handler into a Node.js HTTP request listener",
    ValidatedHandlerConfig: "`createValidatedHandler` config",
    ValidatedHandlerFunction: "Handler with validated inputs",
  },

  "veryfront/head": {
    Head: "Render `<title>`, `<meta>`, `<link>` tags",
  },

  "veryfront/router": {
    Link: "Navigation link (with prefetching)",
    Router: "Internal router managing nav state",
    RouterProvider: "Provide router context to tree",
    useRouter: "Get pathname, params, query, navigate",
    LinkProps: "`<Link>` props",
    RouterProviderProps: "`<RouterProvider>` props",
    RouterValue: "Router context value shape",
  },

  "veryfront/context": {
    PageContextProvider: "Provide page context to children",
    usePageContext: "Get params, frontmatter, headings",
    MdxHeading: "MDX heading (text, id, level)",
    PageContextProviderProps: "`<PageContextProvider>` props",
    PageContextValue: "Page context value shape",
  },

  "veryfront/fonts": {
    GoogleFonts: "Load Google Fonts via CSS variables",
    Font: "Font config (name, weights, variable)",
    GoogleFontsProps: "`<GoogleFonts>` props",
  },

  "veryfront/chat": {
    Chat: "Full chat UI (messages + input)",
    ChatComponents: "Compound components for custom layouts",
    ChatHeader: "Chat header section",
    ChatMessages: "Scrollable message list",
    ModelSelector: "Dropdown for switching models at runtime",
    ChatInput: "Text input with send button",
    ChatFooter: "Chat footer section",
    Message: "Chat message bubble",
    StreamingMessage: "Incrementally rendered message",
    AgentCard: "Agent status, tool calls, and messages",
    AIErrorBoundary: "Error boundary with retry",
    useChat:
      "useChat hook for managing chat state with veryfront stream events",
    useAgent: "Agent interactions with tool call tracking",
    useCompletion: "useCompletion hook for single text generation",
    useStreaming: "Low-level streaming hook",
    useVoiceInput: "Voice input (Web Speech API)",
    useAIErrorHandler: "Programmatic AI error handler",
    ChatProps: "`<Chat>` props",
    MessageProps: "`<Message>` props",
    StreamingMessageProps: "`<StreamingMessage>` props",
    AgentCardProps: "`<AgentCard>` props",
    AIErrorBoundaryProps: "`<AIErrorBoundary>` props",
    ChatTheme: "Theme System for Styled Components",
    AgentTheme: "Agent card theme config",
    UseChatOptions: "`useChat` options",
    UseChatResult: "`useChat` result",
    UseAgentOptions: "`useAgent` options",
    UseAgentResult: "`useAgent` result",
    UseCompletionOptions: "`useCompletion` options",
    UseCompletionResult: "`useCompletion` result",
    UseStreamingOptions: "`useStreaming` options",
    UseStreamingResult: "`useStreaming` result",
    UseVoiceInputOptions: "`useVoiceInput` options",
    UseVoiceInputResult: "`useVoiceInput` result",
    UIMessage: "Normalized UI message",
    UIMessagePart: "UI message segment (text, tool, reasoning)",
    ToolUIPart: "Tool invocation UI part",
    DynamicToolUIPart: "Dynamic tool call UI part",
    ToolState: "Tool state (pending, running, complete)",
    ToolOutput: "Tool execution output",
    TextUIPart: "Text segment of a message",
    ReasoningUIPart: "Chain-of-thought segment",
    ToolResultUIPart: "Tool result UI part",
    OnToolCallArg: "`onToolCall` callback argument",
  },

  "veryfront/markdown": {
    Markdown: "Render markdown with highlighting + diagrams",
    MarkdownProps: "`<Markdown>` props",
    CodeBlockProps: "Code block rendering props",
  },

  "veryfront/mdx": {
    MDXProvider: "Override MDX components",
    useMDXComponents: "Get current MDX overrides",
    MDXProviderProps: "`<MDXProvider>` props",
  },

  "veryfront/agent": {
    agent: "Create agent",
    registerAgent: "Register agent for discovery",
    getAgent: "Get agent by ID",
    getAllAgentIds: "List registered agent IDs",
    agentAsTool: "Wrap agent as callable tool",
    getAgentsAsTools: "Get agents as tools (multi-agent)",
    createWorkflow: "Create sequential agent workflow",
    createMemory: "Create memory (buffer, conversation, summary)",
    createRedisMemory: "Create Redis-backed memory",
    getTextFromParts: "Extract text from multi-part message",
    getToolArguments: "Extract parsed tool call args",
    hasArgs: "Check for parsed args on tool call",
    hasInput: "Check for raw input on tool call",
    AgentRuntime: "Agent execution runtime",
    BufferMemory: "In-memory message buffer",
    ConversationMemory: "Full conversation history",
    SummaryMemory: "Compresses old messages into summaries",
    RedisMemory: "Redis-backed persistent memory",
    Agent: "`agent()` return type",
    AgentConfig: "Agent configuration",
    AgentContext: "Agent handler context",
    AgentMiddleware: "Agent execution middleware",
    AgentResponse: "Agent execution response",
    AgentStatus: "Agent status (idle, running, etc.)",
    AgentStreamResult: "Streaming result (`.toDataStreamResponse()`)",
    Memory: "Memory interface",
    MemoryConfig: "Memory creation config",
    MemoryPersistence: "Memory storage backend",
    MemoryStats: "Memory usage stats",
    Message: "Chat message (user, assistant, system, tool)",
    MessagePart: "Multi-part message segment",
    ModelProvider: "Model provider interface",
    ModelString: 'Model configuration string format: "provider/model-name"',
    RedisClient:
      "Redis client interface (compatible with ioredis and node-redis)",
    RedisMemoryConfig: "Redis memory configuration",
    StreamToolCall: "Streaming tool call",
    ToolCall: "Completed tool call",
    ToolCallPart: "Tool call message segment",
    ToolCallPartWithArgs: "Tool call with parsed args",
    ToolCallPartWithInput: "Tool call with raw input",
    ToolResultPart: "Tool execution result segment",
    EdgeConfig: "Agent-to-agent edge config",
    WorkflowConfig: "`createWorkflow` config",
    WorkflowResult: "Completed workflow result",
    WorkflowStep: "Workflow step definition",
  },

  "veryfront/tool": {
    tool: "Create typed tool (Zod-validated)",
    dynamicTool: "Create tool with runtime schema",
    executeTool: "Execute tool by ID",
    toolRegistry: "Global tool registry",
    Tool: "`tool()` return type",
    ToolConfig: "`tool()` config",
    ToolDefinition: "Serializable tool definition",
    ToolExecutionContext: "Tool execution context",
    DynamicToolConfig: "`dynamicTool()` config",
    JsonSchema: "JSON Schema for tool input",
  },

  "veryfront/workflow": {
    workflow: "Define workflow with step DAG",
    step: "Create workflow step",
    agentStep: "Step that runs an agent",
    toolStep: "Step that executes a tool",
    sequence: "Run steps sequentially",
    parallel: "Run steps in parallel",
    branch: "Conditional branching",
    dag: "Define step dependency graph",
    when: "Execute if condition true",
    unless: "Execute unless condition true",
    loop: "Repeat while condition holds",
    times: "Repeat N times",
    doWhile: "Execute once, then repeat while true",
    map: "Map array items in parallel",
    delay: "Pause for duration",
    dependsOn: "Declare step dependencies",
    subWorkflow: "Embed child workflow",
    waitForApproval: "Pause for human approval",
    waitForEvent: "Pause for external event",
    createWorkflowClient: "HTTP client for workflow management",
    hasWorkerSupport: "Check worker support",
    useWorkflow: "Track workflow status and steps",
    useWorkflowList: "List workflow runs",
    useWorkflowStart: "Start workflow from React",
    useApproval: "Approve or reject workflow",
    WorkflowClient: "Workflow HTTP client",
    MemoryBackend: "In-memory backend (dev)",
    RedisBackend: "Redis backend (production)",
    WorkflowExecutor: "Low-level workflow executor",
    WorkflowDefinition: "Workflow definition",
    WorkflowRun: "Running or completed workflow state",
    WorkflowStatus: "Status (pending, running, completed, failed)",
    WorkflowNode: "DAG node",
    WorkflowNodeConfig: "DAG node config",
    WorkflowOptions: "`workflow()` options",
    WorkflowBackend: "State storage backend interface",
    WorkflowClientConfig: "`createWorkflowClient()` config",
    WorkflowExecutorConfig: "`WorkflowExecutor` config",
    BackendConfig: "Backend base config",
    StepOptions: "`step()` options",
    BranchOptions: "`branch()` options",
    LoopOptions: "`loop()` / `doWhile()` options",
    MapOptions: "`map()` options",
    ParallelOptions: "`parallel()` options",
    SubWorkflowOptions: "`subWorkflow()` options",
    WaitForApprovalOptions: "`waitForApproval()` options",
    WaitForEventOptions: "`waitForEvent()` options",
    UseWorkflowOptions: "`useWorkflow` options",
    UseWorkflowResult: "`useWorkflow` result",
    UseWorkflowListOptions: "`useWorkflowList` options",
    UseWorkflowListResult: "`useWorkflowList` result",
    UseWorkflowStartOptions: "`useWorkflowStart` options",
    UseWorkflowStartResult: "`useWorkflowStart` result",
    UseApprovalOptions: "`useApproval` options",
    UseApprovalResult: "`useApproval` result",
    WorkflowHandle: "Handle for polling/awaiting result",
    CapturedTenantContext: "Captured tenant context",
    WorkflowContext: "Step runtime context",
  },

  "veryfront/prompt": {
    prompt: "Create MCP-discoverable prompt",
    promptRegistry: "Global prompt registry",
    Prompt: "`prompt()` return type",
    PromptConfig: "`prompt()` config",
  },

  "veryfront/resource": {
    resource: "Create MCP-discoverable resource",
    resourceRegistry: "Global resource registry",
    Resource: "`resource()` return type",
    ResourceConfig: "`resource()` config",
  },

  "veryfront/mcp": {
    createMCPServer: "Create MCP server",
    registerTool: "Register tool with MCP",
    registerPrompt: "Register prompt with MCP",
    registerResource: "Register resource with MCP",
    getMCPRegistry: "Get tool/prompt/resource registry",
    getMCPStats: "Get registered capability stats",
    clearMCPRegistry: "Clear all registries",
    MCPServer: "MCP server instance",
    MCPServerConfig: "`createMCPServer()` config",
    MCPStats: "Registry statistics",
    MCPTool: "MCP-exposed tool",
    IntegrationLoaderConfig:
      "Configuration for loading integration tools into MCP",
  },

  "veryfront/middleware": {
    cors: "CORS middleware",
    rateLimit: "Rate limiting (memory or Redis)",
    logger: "Request/response logger",
    devLogger: "Dev logger (colorized)",
    prodLogger: "Production logger (structured JSON)",
    timeout: "Request timeout",
    timeoutFromEnv: "Timeout from env vars",
    getTimeoutFromEnv: "Read timeout config from env",
    MiddlewareContext: "Middleware pipeline context",
    MiddlewarePipeline: "Composable middleware chain",
    MemoryRateLimitStore: "In-memory rate limit store",
    RedisRateLimitStore: "Redis rate limit store",
    Context: "Base request context",
    ExecutionContext: "Context with execution metadata",
    MiddlewareFactory: "Middleware factory function",
    MiddlewareHandler: "Middleware handler function",
    Next: "Next middleware callback",
    CorsOptions: "CORS config",
    RateLimitOptions: "Rate limit config",
    RateLimitStore: "Rate limit storage interface",
    RedisRateLimitOptions: "Redis rate limit config",
    LogFormat: "Log format (combined, common, dev, short)",
    LoggerOptions: "Logger config",
    TimeoutOptions: "Timeout config",
    MiddlewarePipelineOptions: "Pipeline config",
  },

  "veryfront/oauth": {
    createOAuthInitHandler: "Redirect user to OAuth provider",
    createOAuthCallbackHandler: "Exchange auth code for tokens",
    createOAuthStatusHandler: "Check OAuth connection status",
    createOAuthDisconnectHandler: "Revoke and remove tokens",
    OAuthProvider: "Base OAuth provider",
    OAuthService: "Full OAuth flow manager",
    MemoryTokenStore: "In-memory token store (dev)",
    OAuthProviderConfig: "Provider config (client ID, scopes, URLs)",
    OAuthServiceConfig: "OAuth service config",
    OAuthState: "OAuth redirect state param",
    OAuthTokens: "Access + refresh tokens",
    OAuthInitHandlerOptions: "`createOAuthInitHandler()` options",
    OAuthCallbackHandlerOptions: "`createOAuthCallbackHandler()` options",
    AuthorizationUrlOptions: "Authorization URL options",
    TokenExchangeOptions: "Token exchange options",
    TokenExchangeResult: "Token exchange result",
    TokenStore: "Token storage interface",
    airtableConfig: "Airtable",
    asanaConfig: "Asana",
    bitbucketConfig: "Bitbucket",
    boxConfig: "Box",
    calendarConfig: "Google Calendar",
    clickupConfig: "ClickUp",
    confluenceConfig: "Confluence",
    driveConfig: "Google Drive",
    figmaConfig: "Figma",
    freshdeskConfig: "Freshdesk",
    githubConfig: "GitHub",
    gitlabConfig: "GitLab",
    gmailConfig: "Gmail",
    hubspotConfig: "HubSpot",
    intercomConfig: "Intercom",
    jiraConfig: "Jira",
    linearConfig: "Linear",
    mailchimpConfig: "Mailchimp",
    mondayConfig: "Monday.com",
    notionConfig: "Notion",
    oneDriveConfig: "OneDrive",
    outlookConfig: "Outlook",
    pipedriveConfig: "Pipedrive",
    quickbooksConfig: "QuickBooks",
    salesforceConfig: "Salesforce",
    sharePointConfig: "SharePoint",
    sheetsConfig: "Google Sheets",
    shopifyConfig: "Shopify",
    slackConfig: "Slack",
    teamsConfig: "Microsoft Teams",
    trelloConfig: "Trello",
    twitterConfig: "Twitter/X",
    webexConfig: "Webex",
    xeroConfig: "Xero",
    zoomConfig: "Zoom",
  },

  "veryfront/provider": {
    registerModelProvider: "Register a model provider factory",
    resolveModel: 'Resolve "provider/model" to LanguageModel',
    hasModelProvider: "Check if provider is registered",
    getRegisteredModelProviders: "List registered provider names",
    clearModelProviders: "Clear all providers (for testing)",
    ModelProviderFactory: "(modelId: string) => LanguageModel",
  },

  "veryfront/fs": {
    readTextFile: "Read file as UTF-8",
    writeTextFile: "Write UTF-8 to file",
    mkdir: "Create directory (recursive supported)",
    exists: "Check path exists",
    remove: "Delete file or directory",
    readDir: "List directory entries",
    createFileSystem: "Create platform-agnostic FS",
    cwd: "Get project root",
    join: "Join path segments",
    resolve: "Resolve to absolute path",
    dirname: "Get directory of path",
    basename: "Get filename of path",
    extname: "Get file extension",
    FileSystem: "Filesystem interface",
  },

  "veryfront/integrations": {
    EnvVarSchema: "Validates environment variable configuration metadata",
    IntegrationConfigSchema:
      "Validates complete integration connector configuration spec",
    IntegrationNameSchema:
      "Validates integration name against allowed enum values",
    IntegrationPromptSchema:
      "Validates predefined prompt configuration for integrations",
    IntegrationToolSchema:
      "Validates tool definition from connector specification",
    OAuthConfigSchema: "Validates OAuth/API key authentication configuration",
    OAuthFieldSchema: "Validates OAuth form field configuration and mapping",
    clearConnectorCache: "Clear the connector cache (for testing)",
    createIntegrationTools:
      "Generate Tool instances from connector specifications",
    executeEndpoint: "Execute REST or GraphQL endpoints with authentication",
    fetchConnector: "Fetch connector spec from API with LRU caching",
    getConnector: "Look up connector config by name from registry",
    getConnectorNames: "Return readonly array of all connector names",
    getIcon: "Return SVG icon string for integration by name",
    listConnectors: "Return readonly array of all connectors",
    registerIntegrationMCP:
      "Register integration tools into the MCP tool registry",
    EnvVarConfig: "Environment variable requirement with metadata",
    IntegrationConfig: "Complete connector spec: name, auth, tools, prompts",
    IntegrationConnector:
      "Runtime connector with tools and endpoint definitions",
    IntegrationMCPConfig: "Configuration for registering integrations into MCP",
    IntegrationName: "Union type of valid integration name literals",
    IntegrationPrompt: "Predefined prompt template for integration use",
    IntegrationRuntimeConfig:
      "Per-user settings and tool allowlist for integration",
    IntegrationTool: "Integration tool with endpoint execution spec",
    IntegrationToolMeta: "Tool metadata: name, description, write requirements",
    OAuthConfig: "OAuth/API key authentication type and parameters",
    OAuthField: "Form field for OAuth configuration with mapping",
  },

  "veryfront/cli": {
    ensureEnvLoaded:
      "Load `.env` files and initialize environment config if not already done",
    args: "Raw command-line arguments array",
    exitProcess: "Exit the process with the given code",
    getArgs: "Get command-line arguments (cross-runtime)",
    hasEnvLoaded: "Check whether `.env` files have already been loaded",
    loadEnv: "Load environment variables from `.env` files",
    markEnvLoaded: "Mark environment variables as loaded",
    parseCliArgs:
      "Parse raw CLI arguments into a structured object with aliases",
    routeCommand: "Route and execute the appropriate CLI command",
    supportsEnvFiles:
      "Check whether `.env` file loading is supported in the current runtime",
  },
};

// ---------------------------------------------------------------------------
// 1. Read deno.json exports
// ---------------------------------------------------------------------------

/**
 * Synthetic parent pages that group deep imports without a top-level export.
 * Each entry produces a `<slug>.md` page that hosts the deep imports listed
 * under that slug in `deno.json`.
 */
const SYNTHETIC_PARENTS: Record<string, { description: string }> = {
  channels: {
    description:
      "Channel transports for the Veryfront control plane and AG-UI invoke route.",
  },
};

const API_REFERENCE_INDEX_DESCRIPTIONS: Record<string, string> = {
  "veryfront": "Core app config and routing.",
  "veryfront/agent": "Agents, AG-UI handlers, and memory.",
  "veryfront/channels": "Control-plane and invoke transports.",
  "veryfront/chat": "Chat components and hooks.",
  "veryfront/cli": "CLI runtime helpers.",
  "veryfront/context": "Page context.",
  "veryfront/embedding": "Embedding and retrieval helpers.",
  "veryfront/extensions": "Extension contracts and loader helpers.",
  "veryfront/fonts": "Font components.",
  "veryfront/fs": "Filesystem and path utilities.",
  "veryfront/head": "Document metadata components.",
  "veryfront/integrations": "Connector metadata and remote tools.",
  "veryfront/jobs": "Jobs, cron jobs, and background runs.",
  "veryfront/markdown": "Markdown rendering.",
  "veryfront/mcp": "MCP server helpers.",
  "veryfront/mdx": "MDX component overrides.",
  "veryfront/middleware": "HTTP middleware.",
  "veryfront/oauth": "OAuth provider helpers.",
  "veryfront/observability": "Tracing, metrics, errors, and logs.",
  "veryfront/prompt": "MCP prompt definitions.",
  "veryfront/provider": "Model provider registry.",
  "veryfront/resource": "MCP resource definitions.",
  "veryfront/router": "Client navigation and route context.",
  "veryfront/sandbox": "Isolated execution.",
  "veryfront/schemas": "Validation schemas.",
  "veryfront/server": "Server runtime helpers.",
  "veryfront/testing": "Test utilities.",
  "veryfront/tool": "Tool definitions and execution.",
  "veryfront/utils": "Runtime utilities.",
  "veryfront/workflow": "Workflows.",
};

function isTopLevelExportPath(path: string): boolean {
  return path.split("/").length <= 2;
}

function topLevelSlug(exportPath: string): string {
  if (exportPath === ".") return "index";
  return exportPath.replace("./", "").split("/")[0];
}

function createExportEntry(exportPath: string, filePath: string): ExportEntry {
  const slug = exportPath === "." ? "index" : exportPath.replace("./", "");
  const importPath = exportPath === "." ? "veryfront" : `veryfront/${slug}`;
  return { exportPath, importPath, slug, filePath };
}

function createSyntheticEntry(slug: string): ExportEntry {
  const meta = SYNTHETIC_PARENTS[slug];
  return {
    exportPath: `./${slug}`,
    importPath: `veryfront/${slug}`,
    slug,
    filePath: "",
    isSynthetic: true,
    syntheticDescription: meta?.description ?? "",
  };
}

function createDeepImport(
  exportPath: string,
  filePath: string,
  parentSlug: string,
): DeepImport {
  const slugPath = exportPath.replace("./", "");
  const subSlug = slugPath.slice(parentSlug.length + 1);
  return {
    exportPath,
    importPath: `veryfront/${slugPath}`,
    subSlug,
    filePath,
  };
}

function getModuleGroups(): ModuleGroup[] {
  const denoConfig = JSON.parse(Deno.readTextFileSync(`${ROOT}/deno.json`));
  const exports: Record<string, string> = denoConfig.exports ?? {};

  const groups = new Map<string, ModuleGroup>();
  const order: string[] = [];

  // First pass: top-level exports become parents.
  for (const [exportPath, filePath] of Object.entries(exports)) {
    if (!isTopLevelExportPath(exportPath)) continue;
    const parent = createExportEntry(exportPath, filePath);
    if (!groups.has(parent.slug)) {
      order.push(parent.slug);
    }
    groups.set(parent.slug, { parent, deepImports: [] });
  }

  // Second pass: deep imports attach to (or create synthetic) parents.
  for (const [exportPath, filePath] of Object.entries(exports)) {
    if (isTopLevelExportPath(exportPath)) continue;
    const parentSlug = topLevelSlug(exportPath);
    let group = groups.get(parentSlug);
    if (!group) {
      if (!SYNTHETIC_PARENTS[parentSlug]) {
        console.warn(
          `Skipping deep import ${exportPath}: no top-level parent and no SYNTHETIC_PARENTS entry for "${parentSlug}".`,
        );
        continue;
      }
      const parent = createSyntheticEntry(parentSlug);
      group = { parent, deepImports: [] };
      groups.set(parentSlug, group);
      order.push(parentSlug);
    }
    group.deepImports.push(createDeepImport(exportPath, filePath, parentSlug));
  }

  // Stable sort for deep imports within each group.
  for (const group of groups.values()) {
    group.deepImports.sort((a, b) => a.importPath.localeCompare(b.importPath));
  }

  return order
    .map((slug) => groups.get(slug)!)
    .filter(Boolean)
    .sort((a, b) => a.parent.importPath.localeCompare(b.parent.importPath));
}

// ---------------------------------------------------------------------------
// 2. Parse barrel JSDoc
// ---------------------------------------------------------------------------

function parseBarrelJSDoc(content: string): BarrelJSDoc {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("/**")) {
    return EMPTY_BARREL_JSDOC;
  }

  const endIdx = trimmed.indexOf("*/");
  if (endIdx === -1) {
    return EMPTY_BARREL_JSDOC;
  }

  const block = trimmed.slice(3, endIdx);
  const lines = block.split("\n").map((l) => l.replace(/^\s*\*\s?/, ""));

  let moduleName = "";
  const descLines: string[] = [];
  const examples: Array<{ title: string; code: string }> = [];
  let inExample = false;
  let exampleTitle = "";
  let exampleLines: string[] = [];
  let inCodeBlock = false;

  const finishExample = (): void => {
    finalizeExample(examples, exampleTitle, exampleLines);
    exampleTitle = "";
    exampleLines = [];
  };

  for (const line of lines) {
    if (line.startsWith("@module")) {
      moduleName = line.replace("@module", "").trim();
      continue;
    }

    if (line.startsWith("@example")) {
      finishExample();
      exampleTitle = line.replace("@example", "").trim();
      exampleLines = [];
      inExample = true;
      inCodeBlock = false;
      continue;
    }

    if (line.startsWith("@")) {
      finishExample();
      inExample = false;
      continue;
    }

    if (inExample) {
      if (line.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
      }
      exampleLines.push(line);
    } else if (!moduleName || descLines.length > 0 || line.trim()) {
      if (!line.startsWith("@")) {
        descLines.push(line);
      }
    }
  }

  finishExample();

  const description = normalizePublicDocText(
    descLines.join(" ").replace(/\s+/g, " ").trim(),
  );
  return { description, moduleName, examples };
}

function normalizePublicDocText(text: string): string {
  return text
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function finalizeExample(
  examples: Array<{ title: string; code: string }>,
  title: string,
  lines: string[],
): void {
  if (lines.length === 0) {
    return;
  }

  examples.push({ title, code: lines.join("\n") });
}

// ---------------------------------------------------------------------------
// 3. Run deno doc --json for a file
// ---------------------------------------------------------------------------

async function getDenoDoc(filePath: string): Promise<DocNode[]> {
  const absPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  const cmd = new Deno.Command("deno", {
    args: ["doc", "--json", absPath],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const errText = new TextDecoder().decode(stderr);
    console.warn(`  deno doc failed for ${filePath}: ${errText.slice(0, 200)}`);
    return [];
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(stdout));
    return normalizeDenoDoc(parsed);
  } catch {
    return [];
  }
}

function normalizeDenoDoc(parsed: unknown): DocNode[] {
  if (Array.isArray(parsed)) {
    return resolveDenoDocReferences(
      (parsed as DocNode[]).filter(isPublicDocNode),
    );
  }

  const root = asRecord(parsed);
  if (!root) return [];

  if (Array.isArray(root.nodes)) {
    return resolveDenoDocReferences(
      (root.nodes as DocNode[]).filter(isPublicDocNode),
    );
  }

  const nodes = asRecord(root.nodes);
  if (!nodes) return [];

  const symbols = Object.values(nodes).flatMap((node) => {
    const record = asRecord(node);
    return Array.isArray(record?.symbols) ? record.symbols : [];
  });

  return resolveDenoDocReferences(
    symbols.flatMap((symbol) => normalizeDenoDocSymbol(symbol)),
  );
}

function isPublicDocNode(node: DocNode): boolean {
  return asRecord(node)?.declarationKind !== "private";
}

function normalizeDenoDocSymbol(symbol: unknown): DocNode[] {
  const record = asRecord(symbol) as DenoDocSymbol | undefined;
  if (!record?.name || !Array.isArray(record.declarations)) return [];

  return record.declarations
    .map((declaration) => normalizeDenoDocDeclaration(record.name, declaration))
    .filter((node): node is DocNode => node !== undefined);
}

function normalizeDenoDocDeclaration(
  name: string,
  declaration: Record<string, unknown>,
): DocNode | undefined {
  if (declaration.declarationKind === "private") return undefined;

  const kind = typeof declaration.kind === "string" ? declaration.kind : "";
  if (!kind) return undefined;

  const node: DocNode = {
    name,
    kind,
    jsDoc: declaration.jsDoc as DocNode["jsDoc"],
    location: normalizeLocation(declaration.location),
  };
  const def = getDeclarationDef(declaration, kind);

  if (kind === "function") {
    node.functionDef = normalizeFunctionDef(def);
  } else if (kind === "interface") {
    node.interfaceDef = normalizeInterfaceDef(def);
  } else if (kind === "class") {
    node.classDef = normalizeClassDef(def);
  } else if (kind === "typeAlias") {
    node.typeAliasDef = { tsType: normalizeTsType(def.tsType) };
  } else if (kind === "variable") {
    node.variableDef = def;
  } else if (kind === "enum") {
    node.enumDef = def;
  } else if (kind === "reference") {
    const referenceDef = asRecord(declaration.reference_def);
    node.referenceTarget = normalizeLocation(
      def.target ?? referenceDef?.target,
    );
  }

  return node;
}

function getDeclarationDef(
  declaration: Record<string, unknown>,
  kind: string,
): Record<string, unknown> {
  const nestedDef = asRecord(declaration.def);
  if (nestedDef) return nestedDef;

  switch (kind) {
    case "function":
      return asRecord(declaration.functionDef) ?? {};
    case "interface":
      return asRecord(declaration.interfaceDef) ?? {};
    case "class":
      return asRecord(declaration.classDef) ?? {};
    case "typeAlias":
      return asRecord(declaration.typeAliasDef) ?? {};
    case "variable":
      return asRecord(declaration.variableDef) ?? {};
    case "enum":
      return asRecord(declaration.enumDef) ?? {};
    case "reference":
      return asRecord(declaration.referenceDef) ?? {};
    default:
      return {};
  }
}

function resolveDenoDocReferences(nodes: DocNode[]): DocNode[] {
  const concreteByLocation = new Map<string, DocNode>();

  for (const node of nodes) {
    if (node.kind === "reference") continue;
    const key = locationKey(node.location);
    if (key && !concreteByLocation.has(key)) {
      concreteByLocation.set(key, node);
    }
  }

  return nodes.map((node) => {
    if (node.kind !== "reference") return node;

    const referenceTarget = getReferenceTarget(node);
    const key = locationKey(referenceTarget);
    const target = key ? concreteByLocation.get(key) : undefined;
    if (!target) return node;

    return {
      ...target,
      name: node.name,
      jsDoc: node.jsDoc ?? target.jsDoc,
      referenceTarget,
    };
  });
}

function getReferenceTarget(node: DocNode): DenoDocLocation | undefined {
  if (node.referenceTarget) return node.referenceTarget;
  const record = asRecord(node);
  const referenceDef = asRecord(record?.reference_def);
  return normalizeLocation(referenceDef?.target);
}

function normalizeLocation(value: unknown): DenoDocLocation | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    filename: typeof record.filename === "string" ? record.filename : undefined,
    line: typeof record.line === "number" ? record.line : undefined,
    col: typeof record.col === "number" ? record.col : undefined,
    byteIndex: typeof record.byteIndex === "number"
      ? record.byteIndex
      : undefined,
  };
}

function locationKey(
  location: DenoDocLocation | undefined,
): string | undefined {
  if (
    !location?.filename ||
    typeof location.line !== "number" ||
    typeof location.col !== "number"
  ) {
    return undefined;
  }

  return `${location.filename}:${location.line}:${location.col}`;
}

function normalizeFunctionDef(def: Record<string, unknown>): FunctionDef {
  return {
    ...def,
    params: normalizeParams(def.params),
    returnType: normalizeTsType(def.returnType),
  } as FunctionDef;
}

function normalizeInterfaceDef(def: Record<string, unknown>): InterfaceDef {
  return {
    ...def,
    extends: Array.isArray(def.extends) ? def.extends : [],
    constructors: Array.isArray(def.constructors) ? def.constructors : [],
    methods: normalizeMethods(def.methods),
    properties: normalizeProperties(def.properties),
  } as InterfaceDef;
}

function normalizeClassDef(def: Record<string, unknown>): ClassDef {
  return {
    ...def,
    constructors: Array.isArray(def.constructors)
      ? def.constructors.map((constructor) => {
        const record = asRecord(constructor) ?? {};
        return { ...record, params: normalizeParams(record.params) };
      })
      : [],
    methods: normalizeClassMethods(def.methods),
    properties: normalizeProperties(def.properties),
  } as ClassDef;
}

function normalizeMethods(methods: unknown): InterfaceMethod[] {
  if (!Array.isArray(methods)) return [];
  return methods.map((method) => {
    const record = asRecord(method) ?? {};
    return {
      ...record,
      params: normalizeParams(record.params),
      returnType: normalizeTsType(record.returnType),
    } as InterfaceMethod;
  });
}

function normalizeClassMethods(methods: unknown): ClassMethod[] {
  if (!Array.isArray(methods)) return [];
  return methods.map((method) => {
    const record = asRecord(method) ?? {};
    return {
      ...record,
      functionDef: normalizeFunctionDef(asRecord(record.functionDef) ?? {}),
    } as ClassMethod;
  });
}

function normalizeProperties(properties: unknown): InterfaceProperty[] {
  if (!Array.isArray(properties)) return [];
  return properties.map((property) => {
    const record = asRecord(property) ?? {};
    return {
      ...record,
      location: normalizeLocation(record.location),
      tsType: normalizeTsType(record.tsType),
    } as InterfaceProperty;
  });
}

function normalizeParams(params: unknown): FunctionParam[] {
  if (!Array.isArray(params)) return [];
  return params.map((param) => {
    const record = asRecord(param) ?? {};
    return {
      ...record,
      tsType: normalizeTsType(record.tsType),
    } as FunctionParam;
  });
}

function normalizeTsType(type: unknown): TsType | undefined {
  const record = asRecord(type);
  if (!record) return undefined;

  const normalized: Record<string, unknown> = { ...record };
  const kind = typeof record.kind === "string" ? record.kind : "";
  const value = record.value;

  if (kind === "keyword" && typeof value === "string") {
    normalized.keyword = value;
  } else if (kind === "typeRef") {
    const typeRef = asRecord(value) ?? {};
    normalized.typeRef = {
      ...typeRef,
      typeParams: Array.isArray(typeRef.typeParams)
        ? typeRef.typeParams.map((param) => normalizeTsType(param))
        : undefined,
    };
  } else if (kind === "union" && Array.isArray(value)) {
    normalized.union = value.map((item) => normalizeTsType(item));
  } else if (kind === "intersection" && Array.isArray(value)) {
    normalized.intersection = value.map((item) => normalizeTsType(item));
  } else if (kind === "array") {
    normalized.array = normalizeTsType(value);
  } else if (kind === "fnOrConstructor") {
    const fn = asRecord(value) ?? {};
    normalized.fnOrConstructor = {
      ...fn,
      params: normalizeParams(fn.params),
      tsType: normalizeTsType(fn.tsType),
    };
  } else if (kind === "typeLiteral") {
    const literal = asRecord(value) ?? {};
    normalized.typeLiteral = {
      ...literal,
      properties: normalizeProperties(literal.properties),
    };
  } else if (kind === "parenthesized") {
    normalized.parenthesized = normalizeTsType(value);
  } else if (kind === "literal") {
    normalized.literal = asRecord(value);
  } else if (kind === "tuple" && Array.isArray(value)) {
    normalized.tuple = value.map((item) => normalizeTsType(item));
  } else if (kind === "indexedAccess") {
    const indexed = asRecord(value) ?? {};
    normalized.indexedAccess = {
      objType: normalizeTsType(indexed.objType),
      indexType: normalizeTsType(indexed.indexType),
    };
  } else if (kind === "typeOperator") {
    const operator = asRecord(value) ?? {};
    normalized.typeOperator = {
      ...operator,
      tsType: normalizeTsType(operator.tsType),
    };
  } else if (kind === "rest") {
    normalized.rest = normalizeTsType(value);
  } else if (kind === "optional") {
    normalized.optional = normalizeTsType(value);
  }

  return normalized as unknown as TsType;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 4. Categorize doc nodes with source-owned descriptions
// ---------------------------------------------------------------------------

function categorizeNodes(
  nodes: DocNode[],
  importPath: string,
): CategorizedExports {
  const result: CategorizedExports = {
    functions: [],
    types: [],
    classes: [],
    constants: [],
    components: [],
  };

  for (const node of nodes) {
    const name = node.name;
    const desc = getNodeDescription(node);
    const sourceHref = getNodeSourceHref(node);

    switch (node.kind) {
      case "function": {
        pushNodeSummary(
          isComponentLikeName(name) ? result.components : result.functions,
          name,
          desc,
          sourceHref,
        );
        break;
      }
      case "interface":
      case "typeAlias":
      case "enum":
        pushNodeSummary(result.types, name, desc, sourceHref);
        break;
      case "class":
        pushNodeSummary(result.classes, name, desc, sourceHref);
        break;
      case "variable":
        pushNodeSummary(
          isComponentLikeName(name) ? result.components : result.constants,
          name,
          desc,
          sourceHref,
        );
        break;
      default:
        break;
    }
  }

  for (const cat of Object.values(result) as ExportSummary[][]) {
    cat.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

function getNodeDescription(node: DocNode): string {
  return node.jsDoc?.doc ? oneLineDoc(node.jsDoc.doc) : "";
}

function getNodeSourceHref(node: DocNode): string {
  return getSourceHref(node.location);
}

function getSourceHref(location: DenoDocLocation | undefined): string {
  const relativePath = getRelativeSourcePath(location);
  if (!relativePath) return "";

  const lineNumber = location?.line;
  const line = typeof lineNumber === "number" && lineNumber > 0
    ? `#L${lineNumber}`
    : "";
  return `${SOURCE_BASE_URL}/${relativePath}${line}`;
}

function getRelativeSourcePath(location: DenoDocLocation | undefined): string {
  const filename = location?.filename;
  if (!filename) return "";

  let path = filename;
  if (path.startsWith("file://")) {
    path = decodeURIComponent(new URL(path).pathname);
  }

  const rootPrefix = `${ROOT}/`;
  if (!path.startsWith(rootPrefix)) return "";

  return path.slice(rootPrefix.length);
}

function summarizeSourceDocs(nodes: DocNode[]): SourceDocStats {
  const supportedKinds = new Set([
    "function",
    "interface",
    "typeAlias",
    "enum",
    "class",
    "variable",
  ]);

  let total = 0;
  let documented = 0;

  for (const node of nodes) {
    if (!supportedKinds.has(node.kind)) continue;
    total += 1;
    if (getNodeDescription(node)) documented += 1;
  }

  return {
    total,
    documented,
    missing: total - documented,
  };
}

function addSourceDocStats(target: SourceDocStats, next: SourceDocStats): void {
  target.total += next.total;
  target.documented += next.documented;
  target.missing += next.missing;
}

function isComponentLikeName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function pushNodeSummary(
  target: ExportSummary[],
  name: string,
  description: string,
  sourceHref: string,
): void {
  target.push({ name, description, sourceHref });
}

// ---------------------------------------------------------------------------
// 5. Render types to readable markdown strings
// ---------------------------------------------------------------------------

function renderType(t: TsType | undefined): string {
  if (!t) return "unknown";

  switch (t.kind) {
    case "keyword":
      return t.keyword ?? t.repr ?? "unknown";

    case "typeRef": {
      const name = t.typeRef?.typeName ?? t.repr;
      const params = t.typeRef?.typeParams;
      if (params && params.length > 0) {
        return `${name}<${params.map(renderType).join(", ")}>`;
      }
      return name;
    }

    case "union": {
      if (!t.union) return t.repr || "unknown";
      return t.union.map((u) => {
        const rendered = renderType(u);
        // Wrap fn types in parens when inside a union
        if (
          u.kind === "fnOrConstructor" ||
          (u.kind === "parenthesized" &&
            u.parenthesized?.kind === "fnOrConstructor")
        ) {
          return `(${rendered})`;
        }
        return rendered;
      }).join(" | ");
    }

    case "intersection": {
      if (!t.intersection) return t.repr || "unknown";
      return t.intersection.map(renderType).join(" & ");
    }

    case "array":
      if (!t.array) return t.repr || "unknown[]";
      // Wrap complex inner types
      if (t.array.kind === "union" || t.array.kind === "intersection") {
        return `(${renderType(t.array)})[]`;
      }
      return `${renderType(t.array)}[]`;

    case "fnOrConstructor": {
      const fn = t.fnOrConstructor;
      if (!fn) return t.repr || "Function";
      const params = fn.params.map((p) => {
        const opt = p.optional ? "?" : "";
        return `${p.name}${opt}: ${renderType(p.tsType)}`;
      }).join(", ");
      return `(${params}) => ${renderType(fn.tsType)}`;
    }

    case "typeLiteral": {
      const props = t.typeLiteral?.properties;
      if (!props || props.length === 0) return "object";
      if (props.length > 3) return "object";
      const inner = props.map((p) => {
        const opt = p.optional ? "?" : "";
        return `${p.name}${opt}: ${renderType(p.tsType)}`;
      }).join("; ");
      return `{ ${inner} }`;
    }

    case "parenthesized":
      return renderType(t.parenthesized);

    case "literal": {
      if (!t.literal) return t.repr || "literal";
      if (t.literal.kind === "string") return `"${t.literal.string}"`;
      if (t.literal.kind === "number") return String(t.literal.number);
      if (t.literal.kind === "boolean") return String(t.literal.boolean);
      return t.repr || "literal";
    }

    case "this":
      return "this";

    case "tuple": {
      if (!t.tuple) return t.repr || "[]";
      return `[${t.tuple.map(renderType).join(", ")}]`;
    }

    case "indexedAccess": {
      if (!t.indexedAccess) return t.repr || "unknown";
      return `${renderType(t.indexedAccess.objType)}[${
        renderType(t.indexedAccess.indexType)
      }]`;
    }

    case "typeOperator": {
      if (!t.typeOperator) return t.repr || "unknown";
      return `${t.typeOperator.operator} ${renderType(t.typeOperator.tsType)}`;
    }

    case "rest":
      return `...${renderType(t.rest)}`;

    case "optional":
      return `${renderType(t.optional)}?`;

    default:
      return t.repr || "unknown";
  }
}

/** Wrap a rendered type string for safe MDX output in a markdown table cell.
 *  Uses <code> with HTML entities when the type contains characters that MDX
 *  would parse as JSX. Handles pipe escaping for both formats. */
function mdxType(raw: string): string {
  if (/[<>{}]/.test(raw)) {
    const escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/{/g, "&#123;")
      .replace(/}/g, "&#125;")
      .replace(/\|/g, "&#124;");
    return `<code>${escaped}</code>`;
  }
  return `\`${raw.replace(/\|/g, "\\|")}\``;
}

// ---------------------------------------------------------------------------
// 5a. Curated API documentation specs per module
// ---------------------------------------------------------------------------

interface APIDocs {
  functions?: Record<string, { configType?: string }>;
  methods?: Record<string, string>;
  expandTypes?: string[];
}

const API_DOCS: Record<string, APIDocs> = {
  "veryfront/agent": {
    functions: { agent: { configType: "AgentConfig" } },
    methods: { Agent: "Agent instance" },
    expandTypes: ["AgentConfig", "MemoryConfig", "EdgeConfig"],
  },
  "veryfront/tool": {
    functions: { tool: { configType: "ToolConfig" } },
    expandTypes: ["ToolConfig"],
  },
  "veryfront/chat": {
    expandTypes: [
      "UseChatOptions",
      "UseChatResult",
      "UseAgentOptions",
      "UseAgentResult",
    ],
  },
  "veryfront/workflow": {
    functions: { workflow: { configType: "WorkflowOptions" } },
    expandTypes: ["StepOptions", "BranchOptions", "ParallelOptions"],
  },
  "veryfront/middleware": {
    methods: { MiddlewarePipeline: "Composable middleware chain" },
    expandTypes: [
      "CorsOptions",
      "RateLimitOptions",
      "LoggerOptions",
      "TimeoutOptions",
    ],
  },
  "veryfront/provider": {
    functions: {
      registerModelProvider: {},
      resolveModel: {},
      hasModelProvider: {},
      getRegisteredModelProviders: {},
      clearModelProviders: {},
    },
  },
  "veryfront/mcp": {
    functions: { createMCPServer: { configType: "MCPServerConfig" } },
    expandTypes: ["MCPServerConfig"],
  },
  "veryfront/oauth": {
    expandTypes: ["OAuthProviderConfig", "OAuthServiceConfig"],
  },
  "veryfront/prompt": {
    functions: { prompt: { configType: "PromptConfig" } },
    expandTypes: ["PromptConfig"],
  },
  "veryfront/resource": {
    functions: { resource: { configType: "ResourceConfig" } },
    expandTypes: ["ResourceConfig"],
  },
  "veryfront/sandbox": {
    methods: { Sandbox: "Sandbox session client" },
    expandTypes: ["SandboxOptions", "ExecResult", "ExecStreamEvent"],
  },
};

// ---------------------------------------------------------------------------
// 5b. Curated property descriptions for undocumented interface properties
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5b-i. Method descriptions and param descriptions for interface/class methods
// ---------------------------------------------------------------------------

const METHOD_DESCRIPTIONS: Record<
  string,
  Record<string, { desc: string; params?: Record<string, string> }>
> = {
  Agent: {
    generate: {
      desc:
        "Run the agent and return a complete response. Accepts a string or message array as input.",
      params: {
        input: "Prompt string or message history",
        context: "Additional context passed to the agent",
      },
    },
    stream: {
      desc:
        "Run the agent and stream the response. Returns a result with `.toDataStreamResponse()` for API routes.",
      params: {
        input: "Prompt string",
        messages: "Conversation message history",
        context: "Additional context passed to the agent",
        onToolCall: "Callback fired when a tool is invoked",
        onChunk: "Callback fired for each text chunk",
      },
    },
    respond: {
      desc:
        "Handle an incoming HTTP request and return a streaming `Response`. Reads messages from the request body.",
    },
    getMemory: {
      desc: "Get the agent's memory instance.",
    },
    getMemoryStats: {
      desc:
        "Get memory usage statistics (message count, estimated tokens, type).",
    },
    clearMemory: {
      desc: "Clear all stored messages from memory.",
    },
    id: { desc: "The agent's unique identifier." },
    config: { desc: "The agent's configuration." },
  },
  Sandbox: {
    create: {
      desc:
        "Create a new sandbox session. Claims a warm pod or creates a new one.",
      params: {
        options: "Sandbox creation options (auth token + optional API URL).",
      },
    },
    get: {
      desc: "Reconnect to an existing sandbox session.",
      params: {
        id: "Existing sandbox session ID.",
        options: "Sandbox connection options (auth token + optional API URL).",
      },
    },
    executeCommand: {
      desc: "Execute a command and return buffered stdout/stderr + exit code.",
      params: { command: "Bash command string to execute in the sandbox." },
    },
    executeStream: {
      desc: "Execute a command and stream output events as they arrive.",
      params: { command: "Bash command string to execute in the sandbox." },
    },
    readFile: {
      desc: "Read a file from the sandbox workspace.",
      params: { path: "Absolute or workspace-relative file path." },
    },
    writeFiles: {
      desc: "Write one or more files to the sandbox workspace.",
      params: { files: "Array of file descriptors (`{ path, content }`)." },
    },
    heartbeat: {
      desc: "Send a heartbeat to keep the sandbox session alive.",
    },
    close: {
      desc: "Close the sandbox session and mark it for deletion.",
    },
  },
  MiddlewarePipeline: {
    use: {
      desc: "Add a middleware handler to the pipeline.",
      params: { middleware: "Middleware handler function" },
    },
    useFor: {
      desc:
        "Add a middleware handler that only runs for matching URL patterns.",
      params: { pattern: "URL pattern to match", "": "Middleware handler" },
    },
    onTeardown: {
      desc: "Register a cleanup callback that runs after the response is sent.",
      params: { cb: "Cleanup callback" },
    },
    compose: {
      desc: "Compose all registered middleware into a single handler function.",
    },
    execute: {
      desc: "Execute the pipeline for an incoming request.",
      params: {
        req: "Incoming `Request`",
        env: "Environment bindings",
        executionCtx: "Execution context (e.g. `waitUntil`)",
        adapter: "Platform adapter",
      },
    },
    teardown: {
      desc: "Run all registered teardown callbacks.",
    },
    getMiddleware: {
      desc: "List registered middleware with metadata.",
    },
  },
};

const PROPERTY_DESCRIPTIONS: Record<string, Record<string, string>> = {
  AgentConfig: {
    id: "Unique identifier (auto-generated if omitted)",
    model: 'Provider and model (e.g. `"openai/gpt-4o"`)',
    system: "System prompt: string, function, or async function",
    tools: "Tools available to the agent",
    maxSteps: "Max tool-call iterations per request",
    streaming: "Enable streaming responses",
    memory: "Conversation memory settings",
    middleware: "Execution middleware pipeline",
    edge: "Edge runtime configuration",
    multimodal: "Enable vision and/or audio",
    allowedModels:
      'Restrict runtime model overrides to these "provider/model" strings',
    skills:
      "Enable all discovered skills (`true`) or only selected skill IDs (`string[]`)",
  },
  SandboxOptions: {
    apiUrl:
      "Veryfront API base URL. Defaults to VERYFRONT_API_URL environment variable.",
    authToken: "JWT used for sandbox API authentication.",
  },
  ExecResult: {
    stdout: "Buffered standard output from command execution.",
    stderr: "Buffered standard error from command execution.",
    exitCode: "Process exit code.",
  },
  ExecStreamEvent: {
    type: "Event type (`stdout`, `stderr`, `exit`, `error`).",
    data: "Chunk payload for stdout/stderr/error events.",
    exitCode: "Exit code for `exit` events.",
  },
  MemoryConfig: {
    type: 'Memory strategy (`"buffer"`, `"conversation"`, `"summary"`)',
    maxMessages: "Max messages to retain",
    maxTokens: "Token budget for memory",
    persistence: "Storage backend for memory",
  },
  EdgeConfig: {
    runtime: 'Target runtime (`"edge"` or `"nodejs"`)',
    regions: "Deployment regions",
  },
  ToolConfig: {
    id: "Unique tool identifier",
    description: "Human-readable description (shown to LLM)",
    inputSchema: "Zod schema for input validation",
    allowUnknownSchema: "Accept arbitrary JSON input (skip validation)",
    execute: "Tool handler function",
    mcp: "Expose via MCP server",
  },
  UseChatOptions: {
    api: "Chat API endpoint URL",
    initialMessages: "Pre-populated messages",
    headers: "Custom request headers",
    body: "Extra body fields sent with each request",
    credentials: "Fetch credentials mode",
    model: 'Override model at runtime (e.g. "openai/gpt-4o")',
    systemPrompt:
      "System prompt for browser-side inference (server uses agent config)",
    browserFallback:
      "Enable/disable browser fallback when server can't provide AI. Default: true",
    onError: "Error callback",
    onFinish: "Completion callback",
    onResponse: "Raw response callback",
    onToolCall: "Tool call handler for client-side execution",
  },
  UseChatResult: {
    messages: "All messages in the conversation",
    input: "Current input value",
    setInput: "Set input value",
    model: "Current model override (undefined = use agent default)",
    setModel: "Change the model for subsequent requests",
    inferenceMode: "Where inference is currently happening",
    browserStatus:
      "Browser-side model loading/inference status (null when not using browser fallback)",
    handleInputChange: "Bind to input onChange",
    handleSubmit: "Submit current input",
    sendMessage: "Send a message programmatically",
    isLoading: "Whether a request is in flight",
    error: "Last error (if any)",
    stop: "Abort current request",
    reload: "Re-send last user message",
    setMessages: "Replace message history",
    data: "Extra data from server response",
    addToolOutput: "Submit client-side tool result",
  },
  UseAgentOptions: {
    agent: "Agent ID or URL",
    onError: "Error callback",
    onToolCall: "Client-side tool call handler",
    onToolResult: "Tool result callback",
  },
  UseAgentResult: {
    messages: "Agent messages",
    invoke: "Send input to agent",
    isLoading: "Whether agent is running",
    error: "Last error",
    status: "Agent status",
    stop: "Stop agent execution",
    thinking: "Current reasoning text",
    toolCalls: "Active tool calls",
  },
  WorkflowOptions: {
    id: "Unique workflow identifier",
    description: "Human-readable description",
    version: "Semantic version string",
    inputSchema: "Zod schema for workflow input validation",
    outputSchema: "Zod schema for workflow output validation",
    steps: "Workflow step definitions",
    retry: "Retry configuration for failed steps",
    backend: "State storage backend",
    introspect: "Enable runtime introspection for debugging",
    timeout: "Max execution time (ms)",
    retries: "Number of retry attempts on failure",
    onError: "Error handler called when a step fails",
    onComplete: "Callback fired after workflow completes",
  },
  StepOptions: {
    id: "Step identifier",
    description: "Step description",
    execute: "Step handler function",
    agent: "Agent to run (by ID or instance)",
    tool: "Tool to execute (by ID or instance)",
    input: "Step input: static value or function of workflow context",
    checkpoint: "Persist state after this step",
    retry: "Retry configuration for this step",
    retries: "Retry attempts on failure",
    timeout: "Step timeout (ms)",
    skip: "Predicate: skip this step if returns true",
  },
  BranchOptions: {
    condition: "Branch predicate function",
    then: "Steps when condition is true",
    else: "Steps when condition is false",
    checkpoint: "Persist state after this node",
    retry: "Retry configuration",
    timeout: "Node timeout (ms or duration string)",
    skip: "Predicate: skip if returns true",
  },
  ParallelOptions: {
    steps: "Steps to run concurrently",
    maxConcurrency: "Max parallel executions",
    strategy: 'Completion strategy (`"all"`, `"race"`, `"allSettled"`)',
    checkpoint: "Persist state after this node",
    retry: "Retry configuration",
    timeout: "Node timeout (ms or duration string)",
    skip: "Predicate: skip if returns true",
  },
  CorsOptions: {
    origin: "Allowed origins (string, regex, array, or function)",
    methods: "Allowed HTTP methods",
    allowedHeaders: "Allowed request headers",
    exposedHeaders: "Headers exposed to client",
    credentials: "Allow credentials",
    maxAge: "Preflight cache duration (seconds)",
  },
  RateLimitOptions: {
    maxRequests: "Max requests per window",
    windowMs: "Time window (ms)",
    max: "Max requests per window",
    store: "Storage backend",
    keyGenerator: "Function to derive rate limit key from request",
    handler: "Custom response when limit exceeded",
    skip: "Skip rate limiting for matching requests",
  },
  LoggerOptions: {
    format: "Log format (combined, common, dev, short)",
    skip: "Skip logging for matching requests",
    log: "Custom log output function",
  },
  TimeoutOptions: {
    timeout: "Request timeout (ms)",
    message: "Timeout error message",
  },
  MCPServerConfig: {
    name: "Server name",
    version: "Server version",
    tools: "Tools to expose",
    prompts: "Prompts to expose",
    resources: "Resources to expose",
  },
  OAuthProviderConfig: {
    clientId: "OAuth client ID",
    clientSecret: "OAuth client secret",
    scopes: "Requested scopes",
    authorizationUrl: "Authorization endpoint URL",
    tokenUrl: "Token exchange endpoint URL",
    redirectUri: "Redirect URI after authorization",
  },
  OAuthServiceConfig: {
    provider: "OAuth provider configuration",
    tokenStore: "Token storage backend",
  },
  PromptConfig: {
    id: "Unique prompt identifier",
    description: "Human-readable description",
    arguments: "Named arguments with descriptions",
    handler: "Function returning prompt messages",
  },
  ResourceConfig: {
    uri: "Resource URI pattern",
    name: "Human-readable name",
    description: "Resource description",
    pattern: "URI template pattern for parameterized resources",
    mimeType: "Content MIME type",
    paramsSchema: "Zod schema for URI parameters",
    load: "Function returning resource content",
    subscribe: "Async iterable for real-time resource updates",
    handler: "Function returning resource content",
    mcp: "MCP server configuration",
  },
};

// ---------------------------------------------------------------------------
// 5c. Generate API section (function signatures + param tables + methods)
// ---------------------------------------------------------------------------

function findNode(nodes: DocNode[], name: string): DocNode | undefined {
  return nodes.find((n) => n.name === name);
}

function getPropertyDescription(
  typeName: string,
  propName: string,
  prop: InterfaceProperty,
): string {
  // Prefer upstream JSDoc
  if (prop.jsDoc?.doc) return oneLineDoc(prop.jsDoc.doc);
  // Fall back to curated
  return PROPERTY_DESCRIPTIONS[typeName]?.[propName] ?? "";
}

function oneLineDoc(doc: string): string {
  const paragraph = doc.split(/\n\s*\n/)[0] ?? "";
  const lines: string[] = [];

  for (const rawLine of paragraph.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (lines.length > 0 && /^[-*]\s+/.test(line)) break;
    lines.push(line);
  }

  return lines.join(" ")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function renderPropertyTable(
  typeName: string,
  properties: InterfaceProperty[],
  fallbackLocation?: DenoDocLocation,
): string[] {
  const lines: string[] = [];
  lines.push("| Property | Type | Description | Source |");
  lines.push("|----------|------|-------------|--------|");
  for (const prop of properties) {
    const name = prop.optional ? `${prop.name}?` : prop.name;
    const rawType = renderType(prop.tsType);
    const desc = getPropertyDescription(typeName, prop.name, prop);
    const sourceHref = getSourceHref(prop.location ?? fallbackLocation);
    const source = sourceHref ? `[source](${sourceHref})` : "";
    lines.push(`| \`${name}\` | ${mdxType(rawType)} | ${desc} | ${source} |`);
  }
  return lines;
}

function generateAPISection(nodes: DocNode[], importPath: string): string[] {
  const spec = API_DOCS[importPath];
  if (!spec) return [];

  const lines: string[] = [];
  const fallbacks = DESCRIPTIONS[importPath] ?? {};
  let hasContent = false;

  // Document curated functions
  if (spec.functions) {
    for (const [fnName, fnSpec] of Object.entries(spec.functions)) {
      const node = findNode(nodes, fnName);
      if (!node?.functionDef) continue;

      if (!hasContent) {
        lines.push("## API");
        lines.push("");
        hasContent = true;
      }

      const fd = node.functionDef;
      const paramStr = fd.params.map((p) => p.name).join(", ");
      lines.push(`### \`${fnName}(${paramStr})\``);
      lines.push("");

      // Description
      const desc = node.jsDoc?.doc
        ? oneLineDoc(node.jsDoc.doc)
        : fallbacks[fnName] ?? "";
      if (desc) {
        lines.push(desc);
        lines.push("");
      }

      // If configType is specified, expand that interface as a param table
      if (fnSpec.configType) {
        const configNode = findNode(nodes, fnSpec.configType);
        if (
          configNode?.interfaceDef?.properties &&
          configNode.interfaceDef.properties.length > 0
        ) {
          lines.push(
            ...renderPropertyTable(
              fnSpec.configType,
              configNode.interfaceDef.properties,
              configNode.location,
            ),
          );
          lines.push("");
        }
      }

      // Return type
      if (fd.returnType) {
        lines.push(`**Returns:** ${mdxType(renderType(fd.returnType))}`);
        lines.push("");
      }
    }
  }

  // Document instance methods from interfaces
  if (spec.methods) {
    for (const [typeName, _typeDesc] of Object.entries(spec.methods)) {
      const node = findNode(nodes, typeName);

      // Check interface methods
      if (node?.interfaceDef?.methods) {
        const methodMeta = METHOD_DESCRIPTIONS[typeName] ?? {};

        for (const method of node.interfaceDef.methods) {
          if (!hasContent) {
            lines.push("## API");
            lines.push("");
            hasContent = true;
          }

          const paramNames = method.params.map((p) => p.name).join(", ");
          lines.push(
            `### \`${
              typeName.charAt(0).toLowerCase() + typeName.slice(1)
            }.${method.name}(${paramNames})\``,
          );
          lines.push("");

          // Method description: upstream JSDoc first, then curated fallback
          const methodDesc = method.jsDoc?.doc
            ? oneLineDoc(method.jsDoc.doc)
            : methodMeta[method.name]?.desc ?? "";
          if (methodDesc) {
            lines.push(methodDesc);
            lines.push("");
          }

          // If the param is a typed object literal, expand it
          const firstParam = method.params[0];
          if (
            method.params.length === 1 &&
            firstParam?.tsType?.kind === "typeLiteral"
          ) {
            const paramDescs = methodMeta[method.name]?.params ?? {};
            const props = firstParam.tsType.typeLiteral?.properties ?? [];
            if (props.length > 0) {
              const interfaceProps: InterfaceProperty[] = props.map((p) => ({
                name: p.name,
                optional: p.optional,
                tsType: p.tsType,
                // Prefer curated param description, then upstream JSDoc
                jsDoc: paramDescs[p.name]
                  ? { doc: paramDescs[p.name] }
                  : p.jsDoc,
                location: p.location,
              }));
              lines.push(
                ...renderPropertyTable(
                  `${typeName}.${method.name}`,
                  interfaceProps,
                  node.location,
                ),
              );
              lines.push("");
            }
          }

          // Return type
          if (method.returnType) {
            lines.push(
              `**Returns:** ${mdxType(renderType(method.returnType))}`,
            );
            lines.push("");
          }
        }
      }

      // Check class methods
      if (node?.classDef?.methods) {
        const methodMeta = METHOD_DESCRIPTIONS[typeName] ?? {};

        for (const method of node.classDef.methods) {
          if (method.accessibility === "private") continue;

          if (!hasContent) {
            lines.push("## API");
            lines.push("");
            hasContent = true;
          }

          const fd = method.functionDef;
          const paramNames = fd.params.map((p) => p.name).join(", ");
          const instanceName = typeName.charAt(0).toLowerCase() +
            typeName.slice(1);
          const callTarget = method.isStatic ? typeName : instanceName;
          const isAccessor = method.kind === "getter" ||
            method.kind === "setter";
          const signature = isAccessor
            ? `${callTarget}.${method.name}`
            : `${callTarget}.${method.name}(${paramNames})`;
          lines.push(`### \`${signature}\``);
          lines.push("");

          const methodDesc = method.jsDoc?.doc
            ? oneLineDoc(method.jsDoc.doc)
            : methodMeta[method.name]?.desc ?? "";
          if (methodDesc) {
            lines.push(methodDesc);
            lines.push("");
          }

          if (fd.returnType) {
            lines.push(`**Returns:** ${mdxType(renderType(fd.returnType))}`);
            lines.push("");
          }
        }
      }
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// 5d. Generate Type Reference section
// ---------------------------------------------------------------------------

function generateTypeReference(nodes: DocNode[], importPath: string): string[] {
  const spec = API_DOCS[importPath];
  if (!spec?.expandTypes) return [];

  // Skip types already expanded as configType in the API section
  const expandedAsConfig = new Set<string>();
  if (spec.functions) {
    for (const fnSpec of Object.values(spec.functions)) {
      if (fnSpec.configType) expandedAsConfig.add(fnSpec.configType);
    }
  }

  const lines: string[] = [];
  let hasContent = false;
  const fallbacks = DESCRIPTIONS[importPath] ?? {};

  for (const typeName of spec.expandTypes) {
    if (expandedAsConfig.has(typeName)) continue;

    const node = findNode(nodes, typeName);
    let properties: InterfaceProperty[] | undefined;

    if (node?.interfaceDef?.properties) {
      properties = node.interfaceDef.properties;
    } else if (node?.typeAliasDef?.tsType?.kind === "typeLiteral") {
      properties = node.typeAliasDef.tsType.typeLiteral?.properties?.map((
        p,
      ) => ({
        name: p.name,
        optional: p.optional,
        tsType: p.tsType,
        jsDoc: p.jsDoc,
        location: p.location,
      }));
    }

    if (!properties || properties.length === 0) continue;

    if (!hasContent) {
      lines.push("## Type Reference");
      lines.push("");
      hasContent = true;
    }

    lines.push(`### \`${typeName}\``);
    lines.push("");

    const desc = node?.jsDoc?.doc
      ? oneLineDoc(node.jsDoc.doc)
      : fallbacks[typeName] ?? "";
    if (desc) {
      lines.push(desc);
      lines.push("");
    }

    lines.push(...renderPropertyTable(typeName, properties, node?.location));
    lines.push("");
  }

  return lines;
}

// ---------------------------------------------------------------------------
// 5b. CLI command catalog
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  development: "Development",
  deploy: "Deploy & Sync",
  project: "Project",
  files: "Files & Data",
  ai: "AI & Automation",
  auth: "Auth",
};

const CATEGORY_ORDER: CommandCategory[] = [
  "development",
  "deploy",
  "project",
  "files",
  "ai",
  "auth",
];

function generateCLICommandCatalog(): string[] {
  const lines: string[] = [];
  lines.push("## Commands");
  lines.push("");
  lines.push(
    "The CLI groups commands by category. Each command supports `--help` for its full usage, options, and examples (`veryfront <command> --help`). For machine-readable output use `veryfront schema --json`.",
  );
  lines.push("");

  const grouped = new Map<CommandCategory, CommandHelp[]>();
  for (const cmd of Object.values(COMMANDS)) {
    const list = grouped.get(cmd.category) ?? [];
    list.push(cmd);
    grouped.set(cmd.category, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  for (const category of CATEGORY_ORDER) {
    const cmds = grouped.get(category);
    if (!cmds || cmds.length === 0) continue;
    lines.push(`### ${CATEGORY_LABELS[category]}`);
    lines.push("");
    lines.push("| Command | Description |");
    lines.push("|---------|-------------|");
    for (const cmd of cmds) {
      const desc = cmd.description.replace(/\|/g, "\\|");
      lines.push(`| \`veryfront ${cmd.name}\` | ${desc} |`);
    }
    lines.push("");
  }

  return lines;
}

// ---------------------------------------------------------------------------
// 6. Generate MDX content
// ---------------------------------------------------------------------------

interface DeepImportRender {
  deep: DeepImport;
  jsdoc: BarrelJSDoc;
  exports: CategorizedExports;
}

function generateMD(
  entry: ExportEntry,
  jsdoc: BarrelJSDoc,
  exports: CategorizedExports,
  nodes: DocNode[],
  order: number,
  deepImports: DeepImportRender[] = [],
): string {
  const lines: string[] = [];

  const description = entry.isSynthetic
    ? (entry.syntheticDescription ?? "")
    : jsdoc.description;

  // Frontmatter
  lines.push("---");
  lines.push(`title: "${entry.importPath}"`);
  if (description) {
    lines.push(`description: "${description.replace(/"/g, '\\"')}"`);
  }
  lines.push(`order: ${order}`);
  lines.push("---");
  lines.push("");

  // The page title and description come from frontmatter and are rendered by
  // the docs shell. Do not emit the description as body copy, or API reference
  // pages show duplicate subtitles.
  if (entry.isSynthetic) {
    lines.push(
      `\`${entry.importPath}\` has no direct exports. Use the deep imports below.`,
    );
    lines.push("");
  }

  // Import snippet: use curated priority list
  const priorityNames = IMPORT_PRIORITY[entry.importPath];
  const allExportNames = new Set([
    ...exports.functions.map((e) => e.name),
    ...exports.components.map((e) => e.name),
    ...exports.classes.map((e) => e.name),
    ...exports.constants.map((e) => e.name),
  ]);

  // Explicit empty array = skip import section (e.g. CLI executable)
  const importNames: string[] = [];
  if (priorityNames === undefined || priorityNames.length > 0) {
    const priority = priorityNames ?? [];
    importNames.push(...priority.filter((n) => allExportNames.has(n)));
    if (importNames.length < 6) {
      for (const n of allExportNames) {
        if (importNames.length >= 6) break;
        if (!importNames.includes(n)) importNames.push(n);
      }
    }
  }

  if (importNames.length > 0) {
    lines.push("## Import");
    lines.push("");
    lines.push("```ts");
    if (importNames.length <= 3) {
      lines.push(
        `import { ${importNames.join(", ")} } from "${entry.importPath}";`,
      );
    } else {
      lines.push(`import {`);
      for (const name of importNames) {
        lines.push(`  ${name},`);
      }
      lines.push(`} from "${entry.importPath}";`);
    }
    lines.push("```");
    lines.push("");
  }

  // Examples
  if (jsdoc.examples.length > 0) {
    lines.push("## Examples");
    lines.push("");

    for (const example of jsdoc.examples) {
      if (example.title) {
        lines.push(`### ${example.title}`);
        lines.push("");
      }
      lines.push(example.code.trim());
      lines.push("");
    }
  }

  // CLI command catalog (only for veryfront/cli - generated from cli/help/command-definitions.ts)
  if (entry.importPath === "veryfront/cli") {
    lines.push(...generateCLICommandCatalog());
  }

  // API section (function params, return types, instance methods)
  const apiLines = generateAPISection(nodes, entry.importPath);
  if (apiLines.length > 0) {
    lines.push(...apiLines);
  }

  // Type Reference section (expanded interface property tables)
  const typeRefLines = generateTypeReference(nodes, entry.importPath);
  if (typeRefLines.length > 0) {
    lines.push(...typeRefLines);
  }

  // Exports section
  const hasExports = Object.values(exports).some((cat) => cat.length > 0);
  if (hasExports) {
    lines.push("## Exports");
    lines.push("");

    const sections: Array<[string, typeof exports.functions]> = [
      ["Components", exports.components],
      ["Functions", exports.functions],
      ["Classes", exports.classes],
      ["Types", exports.types],
      ["Constants", exports.constants],
    ];

    for (const [title, items] of sections) {
      if (items.length === 0) continue;
      lines.push(`### ${title}`);
      lines.push("");
      lines.push("| Name | Description | Source |");
      lines.push("|------|-------------|--------|");
      for (const e of items) {
        lines.push(`| \`${e.name}\` | ${e.description} | ${sourceCell(e)} |`);
      }
      lines.push("");
    }
  }

  // Deep imports: each deep barrel rendered as a subsection.
  if (deepImports.length > 0) {
    lines.push("## Deep imports");
    lines.push("");
    lines.push(
      "These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.",
    );
    lines.push("");
    for (const di of deepImports) {
      lines.push(`### \`${di.deep.importPath}\``);
      lines.push("");
      if (di.jsdoc.description) {
        lines.push(di.jsdoc.description);
        lines.push("");
      }
      lines.push("```ts");
      const sample = pickDeepImportSample(di.exports);
      if (sample.length > 0) {
        lines.push(
          `import { ${sample.join(", ")} } from "${di.deep.importPath}";`,
        );
      } else {
        lines.push(`import "${di.deep.importPath}";`);
      }
      lines.push("```");
      lines.push("");

      const sections: Array<[string, typeof di.exports.functions]> = [
        ["Components", di.exports.components],
        ["Functions", di.exports.functions],
        ["Classes", di.exports.classes],
        ["Types", di.exports.types],
        ["Constants", di.exports.constants],
      ];
      for (const [label, items] of sections) {
        if (items.length === 0) continue;
        lines.push(`#### ${label}`);
        lines.push("");
        lines.push("| Name | Description | Source |");
        lines.push("|------|-------------|--------|");
        for (const item of items) {
          lines.push(
            `| \`${item.name}\` | ${item.description || ""} | ${
              sourceCell(item)
            } |`,
          );
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function pickDeepImportSample(exports: CategorizedExports): string[] {
  const all = [
    ...exports.functions,
    ...exports.components,
    ...exports.classes,
    ...exports.constants,
  ].map((e) => e.name);
  return all.slice(0, 3);
}

function sourceCell(summary: ExportSummary): string {
  return summary.sourceHref ? `[source](${summary.sourceHref})` : "";
}

// ---------------------------------------------------------------------------
// 7. Generate README for docs/api-reference/
// ---------------------------------------------------------------------------

function generateReadmeMD(
  entries: Array<{ entry: ExportEntry; jsdoc: BarrelJSDoc }>,
): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push('title: "API reference"');
  lines.push('sidebarTitle: "Overview"');
  lines.push(
    'description: "Exact imports, exported names, types, and module-level examples for Veryfront Code."',
  );
  lines.push("order: 1");
  lines.push("---");
  lines.push("");
  lines.push("## Contents");
  lines.push("");
  lines.push("| Import | Description |");
  lines.push("|--------|-------------|");
  const sortedEntries = [...entries].sort((a, b) =>
    a.entry.importPath.localeCompare(b.entry.importPath)
  );
  for (const { entry, jsdoc } of sortedEntries) {
    const desc = API_REFERENCE_INDEX_DESCRIPTIONS[entry.importPath] ??
      (entry.isSynthetic
        ? (entry.syntheticDescription ?? "")
        : (jsdoc.description || ""));
    lines.push(
      `| [\`${entry.importPath}\`](./veryfront/${entry.slug}.md) | ${
        normalizePublicDocText(desc)
      } |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function removeStaleReferencePages(
  expectedSlugs: Set<string>,
): Promise<void> {
  const staleFiles: string[] = [];

  try {
    for await (const entry of Deno.readDir(VERYFRONT_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const slug = entry.name.replace(/\.md$/, "");
      if (!expectedSlugs.has(slug)) {
        staleFiles.push(`${VERYFRONT_DIR}/${entry.name}`);
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }

  for (const file of staleFiles) {
    await Deno.remove(file);
    console.log(`  Removed stale ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Reading deno.json exports...");
  const groups = getModuleGroups();
  console.log(`Found ${groups.length} module groups.`);

  await ensureDir(OUTPUT_DIR);
  await ensureDir(VERYFRONT_DIR);
  await removeStaleReferencePages(
    new Set(groups.map((group) => group.parent.slug)),
  );

  const indexData: Array<{ entry: ExportEntry; jsdoc: BarrelJSDoc }> = [];
  const sourceDocStats: SourceDocStats = {
    total: 0,
    documented: 0,
    missing: 0,
  };

  for (const [idx, group] of groups.entries()) {
    const entry = group.parent;
    console.log(
      `Processing ${entry.importPath}${
        entry.isSynthetic ? " (synthetic)" : ` (${entry.filePath})`
      }...`,
    );

    let jsdoc: BarrelJSDoc;
    let nodes: DocNode[] = [];
    let exports: CategorizedExports = {
      functions: [],
      types: [],
      classes: [],
      constants: [],
      components: [],
    };

    if (entry.isSynthetic) {
      jsdoc = {
        description: entry.syntheticDescription ?? "",
        moduleName: entry.importPath,
        examples: [],
      };
    } else {
      const absFilePath = `${ROOT}/${entry.filePath.replace("./", "")}`;
      try {
        const content = await Deno.readTextFile(absFilePath);
        jsdoc = parseBarrelJSDoc(content);
      } catch (err) {
        console.warn(`  Could not read ${entry.filePath}: ${err}`);
        jsdoc = { description: "", moduleName: "", examples: [] };
      }
      nodes = await getDenoDoc(entry.filePath);
      addSourceDocStats(sourceDocStats, summarizeSourceDocs(nodes));
      exports = categorizeNodes(nodes, entry.importPath);
    }

    indexData.push({ entry, jsdoc });

    const deepRenders: DeepImportRender[] = [];
    for (const deep of group.deepImports) {
      const absFilePath = `${ROOT}/${deep.filePath.replace("./", "")}`;
      let deepJsdoc: BarrelJSDoc;
      try {
        const content = await Deno.readTextFile(absFilePath);
        deepJsdoc = parseBarrelJSDoc(content);
      } catch {
        deepJsdoc = { description: "", moduleName: "", examples: [] };
      }
      const deepNodes = await getDenoDoc(deep.filePath);
      addSourceDocStats(sourceDocStats, summarizeSourceDocs(deepNodes));
      const deepExports = categorizeNodes(deepNodes, deep.importPath);
      deepRenders.push({ deep, jsdoc: deepJsdoc, exports: deepExports });
    }

    const order = idx + 1;
    const md = normalizeGeneratedMarkdown(
      generateMD(entry, jsdoc, exports, nodes, order, deepRenders),
    );
    const outPath = `${VERYFRONT_DIR}/${entry.slug}.md`;
    await Deno.writeTextFile(outPath, md);
    console.log(`  Wrote ${outPath}`);
  }

  // Write the public section landing page at the docs/api-reference root.
  const indexMD = normalizeGeneratedMarkdown(generateReadmeMD(indexData));
  const indexPath = `${OUTPUT_DIR}/index.md`;
  await Deno.writeTextFile(indexPath, indexMD);
  try {
    await Deno.remove(`${OUTPUT_DIR}/overview.md`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  try {
    await Deno.remove(`${OUTPUT_DIR}/README.md`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  console.log(`\nWrote ${indexPath}`);
  console.log(`Generated ${groups.length} MD files in ${VERYFRONT_DIR}`);
  console.log(
    `Source JSDoc coverage: ${sourceDocStats.documented}/${sourceDocStats.total} public declarations documented (${sourceDocStats.missing} missing).`,
  );
}

main();

function normalizeGeneratedMarkdown(markdown: string): string {
  return markdown.replace(/[\u2013\u2014]/g, "-");
}
