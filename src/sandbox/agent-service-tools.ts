import { INVALID_ARGUMENT } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import type {
  BackgroundCommand,
  BackgroundCommandOutput,
  ExecOptions,
  ExecResult,
} from "./sandbox.ts";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import {
  MAX_SANDBOX_COMMAND_LENGTH,
  MAX_SANDBOX_IDENTIFIER_LENGTH,
  normalizeExecRequest,
  normalizeSandboxProjectId,
} from "./protocol.ts";
import {
  type BashToolSandboxLike,
  type CreateSandboxBashTool,
  createSandboxShellTools,
  type SandboxShellToolSet,
} from "./shell-tools.ts";

const SANDBOX_WORKING_DIRECTORY = "/workspace";
const SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN =
  /^\s*(?:mkdir -p \/tmp\/bash-tool\s*&&\s*)?cd\s+"\/workspace"\s*&&\s*/i;
const RESERVED_BACKGROUND_TOOL_NAMES = [
  "start_background_command",
  "get_background_command",
  "get_background_command_output",
  "cancel_background_command",
] as const;

/** Public API contract for agent service sandbox background command client. */
export interface AgentServiceSandboxBackgroundCommandClient {
  /** Start a background command. */
  startBackgroundCommand(command: string): Promise<BackgroundCommand>;
  /** Read the current background command status. */
  getBackgroundCommand(commandId: string): Promise<BackgroundCommand>;
  /** Read captured output and terminal metadata for a background command. */
  getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput>;
  /** Cancel a background command. */
  cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand>;
}

/** Public API contract for agent service sandbox client. */
export interface AgentServiceSandboxClient
  extends BashToolSandboxLike, AgentServiceSandboxBackgroundCommandClient {
  /** Execute a command and collect its output. */
  executeCommand(command: string, options?: unknown): Promise<ExecResult>;
  /** Provision or attach the lazy session. */
  ensure(): Promise<void>;
  /** Close or detach the lazy session. */
  close(): Promise<void>;
  /** Whether the client currently owns an active runtime endpoint. */
  readonly isActive: boolean;
  /** Current session identifier, when provisioned. */
  readonly id: string | null;
  /** Current runtime endpoint, when provisioned. */
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
  /** Sandbox shell and background command tools. */
  tools: SandboxShellToolSet;
  /** Lazy sandbox client used by the tools. */
  sandbox: AgentServiceSandboxClient;
  /** Idempotent cleanup callback for the lazy sandbox client. */
  closeSandbox: () => Promise<void>;
}

/** Unwrap sandbox working directory command. */
export function unwrapSandboxWorkingDirectoryCommand(command: string): string {
  const trimmedCommand = normalizeExecRequest(command).command.trim();
  if (!SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN.test(trimmedCommand)) {
    return trimmedCommand;
  }

  return trimmedCommand.replace(SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN, "").trim();
}

/** Options accepted by create project scoped exec. */
export function createProjectScopedExecOptions(
  projectReference: string | null | undefined,
): ExecOptions {
  const normalized = normalizeSandboxProjectId(projectReference);
  return normalized ? { projectReference: normalized } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSandboxFileContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof Uint8Array) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw INVALID_ARGUMENT.create({
        detail: "Sandbox byte content must contain valid UTF-8",
      });
    }
  }
  if (content === undefined || content === null) return "";
  throw INVALID_ARGUMENT.create({
    detail: "Sandbox writeFiles content must be a string or UTF-8 byte array",
  });
}

function normalizeSandboxWriteFile(file: unknown): { path: string; content: string } {
  if (!isRecord(file) || typeof file.path !== "string") {
    throw INVALID_ARGUMENT.create({
      detail: "Sandbox writeFiles entries must include a string path",
    });
  }

  return {
    path: file.path,
    content: toSandboxFileContent(file.content),
  };
}

/** Create agent service sandbox client. */
export function createAgentServiceSandboxClient(
  input: AgentServiceSandboxClientOptions = {},
): AgentServiceSandboxClient {
  if (!isRecord(input as unknown)) {
    throw INVALID_ARGUMENT.create({ detail: "Agent service sandbox options must be an object" });
  }
  const getProjectId = input.getProjectId ?? (() => input.projectId);
  const sandbox = new LazySandbox({ ...input, getProjectId });

  return {
    ensure: () => sandbox.ensure(),
    async executeCommand(command, options) {
      return await sandbox.executeCommand(command, options as ExecOptions | undefined);
    },
    readFile: (path) => sandbox.readFile(path),
    writeFiles: (files) => {
      if (!Array.isArray(files)) {
        throw INVALID_ARGUMENT.create({ detail: "Sandbox writeFiles input must be an array" });
      }
      return sandbox.writeFiles(files.map((file) => normalizeSandboxWriteFile(file)));
    },
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
    command: v.string().min(1).max(MAX_SANDBOX_COMMAND_LENGTH).describe(
      "Single shell command to run asynchronously in the sandbox",
    ),
  })
);

const getBackgroundCommandIdInputSchema = defineSchema((v) =>
  v.object({
    commandId: v.string().min(1).max(MAX_SANDBOX_IDENTIFIER_LENGTH).describe(
      "Sandbox background command ID",
    ),
  })
);

/** Create agent service sandbox tools. */
export async function createAgentServiceSandboxTools(
  input: AgentServiceSandboxToolsOptions,
): Promise<AgentServiceSandboxToolsResult> {
  if (!isRecord(input as unknown) || typeof input.createBashTool !== "function") {
    throw INVALID_ARGUMENT.create({
      detail: "Agent service sandbox tools require a createBashTool function",
    });
  }
  const sandbox = createAgentServiceSandboxClient(input);
  let shellTools: SandboxShellToolSet;
  try {
    shellTools = await createSandboxShellTools(sandbox, input.createBashTool);
    const collision = RESERVED_BACKGROUND_TOOL_NAMES.find((name) => shellTools[name] !== undefined);
    if (collision) {
      throw INVALID_ARGUMENT.create({
        detail: `Sandbox shell tool provider returned reserved tool name: ${collision}`,
      });
    }
  } catch (error) {
    try {
      await sandbox.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Failed to create sandbox tools and clean up the sandbox",
      );
    }
    throw error;
  }

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
export const createHostedSandboxClient: typeof createAgentServiceSandboxClient =
  createAgentServiceSandboxClient;
/** Create hosted sandbox tools. */
export const createHostedSandboxTools: typeof createAgentServiceSandboxTools =
  createAgentServiceSandboxTools;
