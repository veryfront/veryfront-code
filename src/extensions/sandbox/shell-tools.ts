import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema/json-schema.ts";

export const SandboxShellToolsProviderName = "SandboxShellToolsProvider";

export type SandboxShellToolExecute = {
  bivarianceHack: (input: unknown, options?: ToolExecutionContext) => Promise<unknown> | unknown;
}["bivarianceHack"];

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

export type SandboxShellToolSet = Record<string, SandboxShellToolDefinition>;

export type SandboxShellClient = {
  ensure?: () => Promise<void> | void;
  executeCommand: (command: string, options?: unknown) => Promise<unknown>;
  readFile?: (path: string) => Promise<unknown> | unknown;
  writeFiles?: (files: unknown[]) => Promise<unknown> | unknown;
};

export type CreateSandboxShellToolsInput = {
  sandbox: SandboxShellClient;
  destination: string;
  promptOptions: {
    toolPrompt: string;
  };
};

export type SandboxShellToolsProvider = (
  input: CreateSandboxShellToolsInput,
) => Promise<{ tools: Record<string, unknown> }>;
