import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import type { BackgroundCommand, BackgroundCommandOutput, ExecOptions } from "./sandbox.ts";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import {
  type BashToolSandboxLike,
  type CreateSandboxBashTool,
  createSandboxShellTools,
  type SandboxShellToolSet,
} from "./shell-tools.ts";

const SANDBOX_WORKING_DIRECTORY = "/workspace";
const SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN =
  /^\s*(?:mkdir -p \/tmp\/bash-tool\s*&&\s*)?cd\s+"\/workspace"\s*&&\s*/i;

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
  return projectReference ? { projectReference } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSandboxFileContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof Uint8Array) {
    return new TextDecoder().decode(content);
  }
  return String(content ?? "");
}

function normalizeSandboxWriteFile(file: unknown): { path: string; content: string } {
  if (!isRecord(file) || typeof file.path !== "string") {
    throw new Error("Sandbox writeFiles entries must include a string path");
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
  const getProjectId = input.getProjectId ?? (() => input.projectId);
  const sandbox = new LazySandbox({ ...input, getProjectId });

  const getExecOptions = () => createProjectScopedExecOptions(getProjectId());
  const getBackgroundCommandExecOptions = () => ({
    ...getExecOptions(),
    cwd: SANDBOX_WORKING_DIRECTORY,
  });

  return {
    ensure: () => sandbox.ensure(),
    async executeCommand(command) {
      return await sandbox.executeCommand(command, getExecOptions());
    },
    readFile: (path) => sandbox.readFile(path),
    writeFiles: (files) => sandbox.writeFiles(files.map((file) => normalizeSandboxWriteFile(file))),
    startBackgroundCommand: (command) =>
      sandbox.startBackgroundCommand(
        unwrapSandboxWorkingDirectoryCommand(command),
        getBackgroundCommandExecOptions(),
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
