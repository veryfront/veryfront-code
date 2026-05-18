import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema/json-schema.ts";

/** Render sandbox shell tools provider name. */
export const SandboxShellToolsProviderName = "SandboxShellToolsProvider";

/** Public API contract for sandbox shell tool execute. */
export type SandboxShellToolExecute = {
  bivarianceHack: (input: unknown, options?: ToolExecutionContext) => Promise<unknown> | unknown;
}["bivarianceHack"];

/** Definition for sandbox shell tool. */
export type SandboxShellToolDefinition = {
  id?: string;
  type?: Tool["type"];
  title?: string;
  description?: string;
  inputSchema?: unknown;
  inputSchemaJson?: JsonSchema;
  parameters?: unknown;
  providerOptions?: unknown;
  execute?: Tool["execute"] | SandboxShellToolExecute;
  mcp?: Tool["mcp"];
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
