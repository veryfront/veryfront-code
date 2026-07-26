import { INVALID_ARGUMENT } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import type { BackgroundCommand, BackgroundCommandOutput, ExecOptions } from "./sandbox.ts";
import { resolveSandboxProjectId } from "./config.ts";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import {
  MAX_SANDBOX_WRITE_BYTES,
  MAX_SANDBOX_WRITE_FILES,
  normalizeSandboxFiles,
} from "./request-payload.ts";
import {
  type BashToolSandboxLike,
  type CreateSandboxBashTool,
  createSandboxShellTools,
  type SandboxShellToolSet,
} from "./shell-tools.ts";

const SANDBOX_WORKING_DIRECTORY = "/workspace";
const SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN =
  /^\s*(?:mkdir -p \/tmp\/bash-tool\s*&&\s*)?cd\s+"\/workspace"\s*&&\s*/i;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

/** Public API contract for agent service sandbox background command client. */
export interface AgentServiceSandboxBackgroundCommandClient {
  startBackgroundCommand(command: string): Promise<BackgroundCommand>;
  getBackgroundCommand(commandId: string): Promise<BackgroundCommand>;
  getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput>;
  cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand>;
}

/** Public API contract for agent service sandbox client. */
export interface AgentServiceSandboxClient
  extends BashToolSandboxLike, AgentServiceSandboxBackgroundCommandClient {
  ensure(): Promise<void>;
  close(): Promise<void>;
  readonly isActive: boolean;
  readonly id: string | null;
  readonly url: string | null;
}

/** Options accepted by agent service sandbox client. */
export interface AgentServiceSandboxClientOptions extends LazySandboxOptions {}

/** Options accepted by agent service sandbox tools. */
export interface AgentServiceSandboxToolsOptions extends AgentServiceSandboxClientOptions {
  /** Sandbox shell tools provider. Kept as createBashTool for caller compatibility. */
  createBashTool: CreateSandboxBashTool;
}

/** Result returned from agent service sandbox tools. */
export interface AgentServiceSandboxToolsResult {
  tools: SandboxShellToolSet;
  sandbox: AgentServiceSandboxClient;
  closeSandbox: () => Promise<void>;
}

/** Unwrap sandbox working directory command. */
export function unwrapSandboxWorkingDirectoryCommand(command: string): string {
  const trimmedCommand = command.trim();
  if (!SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN.test(trimmedCommand)) {
    return trimmedCommand;
  }

  return trimmedCommand.replace(SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN, "").trim();
}

/** Options accepted by create project scoped exec. */
export function createProjectScopedExecOptions(
  projectReference: string | null | undefined,
): ExecOptions {
  const normalized = resolveSandboxProjectId(projectReference);
  return normalized ? { projectReference: normalized } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(detail: string, cause?: unknown): never {
  throw INVALID_ARGUMENT.create({ detail, cause });
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
  entryIndex: number,
): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) {
    invalid(`Sandbox writeFiles entry ${entryIndex} must include ${key}`);
  }
  if (!("value" in descriptor)) {
    invalid(`Sandbox writeFiles entry ${entryIndex} ${key} must be a data property`);
  }
  return descriptor.value;
}

function toSandboxFileContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof Uint8Array) {
    if (content.byteLength > MAX_SANDBOX_WRITE_BYTES) {
      invalid(`Sandbox writeFiles binary content exceeds ${MAX_SANDBOX_WRITE_BYTES} bytes`);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch (cause) {
      invalid("Sandbox writeFiles binary content must be valid UTF-8", cause);
    }
  }
  invalid("Sandbox writeFiles content must be a string or Uint8Array");
}

function normalizeSandboxWriteFile(
  file: unknown,
  entryIndex: number,
): { path: string; content: string } {
  if (!isRecord(file)) {
    invalid(`Sandbox writeFiles entry ${entryIndex} must be an object`);
  }

  const path = ownDataValue(file, "path", entryIndex);
  if (typeof path !== "string") {
    invalid(`Sandbox writeFiles entry ${entryIndex} path must be a string`);
  }

  return {
    path,
    content: toSandboxFileContent(ownDataValue(file, "content", entryIndex)),
  };
}

function normalizeSandboxWriteFiles(files: unknown[]): Array<{ path: string; content: string }> {
  if (!Array.isArray(files)) {
    invalid("Sandbox writeFiles input must be an array");
  }
  if (files.length > MAX_SANDBOX_WRITE_FILES) {
    invalid(`Sandbox writeFiles input exceeds ${MAX_SANDBOX_WRITE_FILES} files`);
  }

  const normalized: Array<{ path: string; content: string }> = [];
  for (let index = 0; index < files.length; index += 1) {
    const descriptor = getOwnPropertyDescriptor(files, String(index));
    if (!descriptor || !("value" in descriptor)) {
      invalid(`Sandbox writeFiles entry ${index} must be a data property`);
    }
    normalized.push(normalizeSandboxWriteFile(descriptor.value, index));
  }
  return normalizeSandboxFiles(normalized);
}

/** Create agent service sandbox client. */
export function createAgentServiceSandboxClient(
  input: AgentServiceSandboxClientOptions = {},
): AgentServiceSandboxClient {
  const getProjectId = input.getProjectId ?? (() => input.projectId);
  const sandbox = new LazySandbox({ ...input, getProjectId });

  return {
    ensure: () => sandbox.ensure(),
    async executeCommand(command) {
      return await sandbox.executeCommand(command);
    },
    readFile: (path) => sandbox.readFile(path),
    writeFiles: (files) => sandbox.writeFiles(normalizeSandboxWriteFiles(files)),
    startBackgroundCommand: (command) =>
      sandbox.startBackgroundCommand(
        unwrapSandboxWorkingDirectoryCommand(command),
        { cwd: SANDBOX_WORKING_DIRECTORY },
      ),
    getBackgroundCommand: (commandId) => sandbox.getBackgroundCommand(commandId),
    getBackgroundCommandOutput: (commandId) => sandbox.getBackgroundCommandOutput(commandId),
    cancelBackgroundCommand: (commandId) => sandbox.cancelBackgroundCommand(commandId),
    close: () => sandbox.close(),
    get isActive() {
      return sandbox.isActive;
    },
    get id() {
      return sandbox.id;
    },
    get url() {
      return sandbox.url;
    },
  };
}

const getStartBackgroundCommandInputSchema = defineSchema((v) =>
  v.object({
    command: v.string().describe("Single shell command to run asynchronously in the sandbox"),
  })
);

const getBackgroundCommandIdInputSchema = defineSchema((v) =>
  v.object({
    commandId: v.string().describe("Sandbox background command ID"),
  })
);

/** Create agent service sandbox tools. */
export async function createAgentServiceSandboxTools(
  input: AgentServiceSandboxToolsOptions,
): Promise<AgentServiceSandboxToolsResult> {
  const sandbox = createAgentServiceSandboxClient(input);
  const shellTools = await createSandboxShellTools(sandbox, input.createBashTool);

  const tools: SandboxShellToolSet = {
    ...shellTools,
    start_background_command: tool({
      description:
        "Start a long-running sandbox command as an async background command. Use this instead of bash for durable shell operations.",
      inputSchema: getStartBackgroundCommandInputSchema(),
      execute: async ({ command }) => await sandbox.startBackgroundCommand(command),
    }),
    get_background_command: tool({
      description:
        "Get the current status for an async sandbox background command. Use this for polling while a long-running command is still running.",
      inputSchema: getBackgroundCommandIdInputSchema(),
      execute: async ({ commandId }) => await sandbox.getBackgroundCommand(commandId),
    }),
    get_background_command_output: tool({
      description:
        "Get the captured stdout/stderr and terminal metadata for an async sandbox background command. Prefer calling this after the command reaches a terminal state.",
      inputSchema: getBackgroundCommandIdInputSchema(),
      execute: async ({ commandId }) => await sandbox.getBackgroundCommandOutput(commandId),
    }),
    cancel_background_command: tool({
      description: "Cancel a running async sandbox background command.",
      inputSchema: getBackgroundCommandIdInputSchema(),
      execute: async ({ commandId }) => await sandbox.cancelBackgroundCommand(commandId),
    }),
  };

  return {
    tools,
    sandbox,
    closeSandbox: () => sandbox.close(),
  };
}

/** Public API contract for hosted sandbox background command client. */
export type HostedSandboxBackgroundCommandClient = AgentServiceSandboxBackgroundCommandClient;
/** Public API contract for hosted sandbox client. */
export type HostedSandboxClient = AgentServiceSandboxClient;
/** Options accepted by hosted sandbox client. */
export type HostedSandboxClientOptions = AgentServiceSandboxClientOptions;
/** Options accepted by hosted sandbox tools. */
export type HostedSandboxToolsOptions = AgentServiceSandboxToolsOptions;
/** Result returned from hosted sandbox tools. */
export type HostedSandboxToolsResult = AgentServiceSandboxToolsResult;

/** Create hosted sandbox client. */
export const createHostedSandboxClient = createAgentServiceSandboxClient;
/** Create hosted sandbox tools. */
export const createHostedSandboxTools = createAgentServiceSandboxTools;
