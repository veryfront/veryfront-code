import type { JsonSchema as SandboxShellToolJsonSchema } from "../schema/json-schema.ts";

export type { JsonSchema as SandboxShellToolJsonSchema } from "../schema/json-schema.ts";
export type {
  JsonSchemaTypeName as SandboxShellToolJsonSchemaTypeName,
} from "../schema/json-schema.ts";

/** Render sandbox shell tools provider name. */
export const SandboxShellToolsProviderName = "SandboxShellToolsProvider";

/** Tool type values accepted by sandbox shell tool definitions. */
export type SandboxShellToolType = "function" | "dynamic";

/**
 * Execution context accepted by sandbox shell tools.
 *
 * The open shape keeps the extension boundary compatible with host-specific
 * tool context fields without coupling the sandbox contract to the tool module.
 */
export type SandboxShellToolExecutionContext = {
  /** Abort signal for cooperative cancellation. */
  abortSignal?: AbortSignal;
  /** Additional host-provided execution context. */
  [key: string]: unknown;
};

/** Public API contract for sandbox shell tool execute. */
export type SandboxShellToolExecute = {
  bivarianceHack(
    input: unknown,
    options?: SandboxShellToolExecutionContext,
  ): Promise<unknown> | unknown;
}["bivarianceHack"];

/** Behavioral hints exposed to MCP clients for a sandbox shell tool. */
export type SandboxShellToolAnnotations = {
  /** The tool does not modify its environment. */
  readOnlyHint?: boolean;
  /** The tool may perform destructive operations. */
  destructiveHint?: boolean;
  /** Repeating the same call has no additional effect. */
  idempotentHint?: boolean;
  /** The tool may interact with resources outside its local environment. */
  openWorldHint?: boolean;
};

/** MCP metadata accepted on a sandbox shell tool definition. */
export type SandboxShellToolMcpConfig = {
  /** Expose the tool through MCP. */
  enabled?: boolean;
  /** Require authentication for MCP calls. */
  requiresAuth?: boolean;
  /** Cache policy applied by MCP hosts. */
  cachePolicy?: "no-cache" | "cache" | "cache-first";
  /** Human-readable display title. */
  title?: string;
  /** Behavioral hints exposed to MCP clients. */
  annotations?: SandboxShellToolAnnotations;
  /** Additional host-specific MCP metadata. */
  [key: string]: unknown;
};

/** Definition for sandbox shell tool. */
export type SandboxShellToolDefinition = {
  id?: string;
  type?: SandboxShellToolType;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  inputSchemaJson?: SandboxShellToolJsonSchema;
  parameters?: unknown;
  providerOptions?: unknown;
  execute?: SandboxShellToolExecute;
  mcp?: SandboxShellToolMcpConfig;
};

/** Public API contract for sandbox shell tool set. */
export type SandboxShellToolSet = Record<string, SandboxShellToolDefinition>;

/** Public API contract for sandbox shell client. */
export type SandboxShellClient = {
  ensure?: () => Promise<void> | void;
  executeCommand: (command: string, options?: unknown) => Promise<unknown>;
  readFile?: (path: string) => Promise<unknown> | unknown;
  writeFiles?: (files: unknown[]) => Promise<unknown> | unknown;
};

/** Input payload for create sandbox shell tools. */
export type CreateSandboxShellToolsInput = {
  sandbox: SandboxShellClient;
  destination: string;
  promptOptions: {
    toolPrompt: string;
  };
};

/** Public API contract for sandbox shell tools provider. */
export type SandboxShellToolsProvider = (
  input: CreateSandboxShellToolsInput,
) => Promise<{ tools: Record<string, unknown> }>;
