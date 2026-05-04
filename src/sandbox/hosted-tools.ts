import { z } from "zod";
import { tool } from "#veryfront/tool";
import type { CommandJob, CommandJobOutput, ExecOptions } from "./sandbox.ts";
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

export interface HostedSandboxJobClient {
  startCommandJob(command: string): Promise<CommandJob>;
  getCommandJob(jobId: string): Promise<CommandJob>;
  getCommandJobOutput(jobId: string): Promise<CommandJobOutput>;
  cancelCommandJob(jobId: string): Promise<CommandJob>;
}

export interface HostedSandboxClient extends BashToolSandboxLike, HostedSandboxJobClient {
  ensure(): Promise<void>;
  close(): Promise<void>;
  readonly isActive: boolean;
  readonly id: string | null;
  readonly url: string | null;
}

export interface HostedSandboxClientOptions extends LazySandboxOptions {}

export interface HostedSandboxToolsOptions extends HostedSandboxClientOptions {
  createBashTool: CreateSandboxBashTool;
}

export interface HostedSandboxToolsResult {
  tools: SandboxShellToolSet;
  sandbox: HostedSandboxClient;
  closeSandbox: () => Promise<void>;
}

export function unwrapSandboxWorkingDirectoryCommand(command: string): string {
  const trimmedCommand = command.trim();
  if (!SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN.test(trimmedCommand)) {
    return trimmedCommand;
  }

  return trimmedCommand.replace(SANDBOX_WORKING_DIRECTORY_PREFIX_PATTERN, "").trim();
}

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

export function createHostedSandboxClient(
  input: HostedSandboxClientOptions = {},
): HostedSandboxClient {
  const getProjectId = input.getProjectId ?? (() => input.projectId);
  const sandbox = new LazySandbox({ ...input, getProjectId });

  const getExecOptions = () => createProjectScopedExecOptions(getProjectId());
  const getCommandJobExecOptions = () => ({
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
    startCommandJob: (command) =>
      sandbox.startCommandJob(
        unwrapSandboxWorkingDirectoryCommand(command),
        getCommandJobExecOptions(),
      ),
    getCommandJob: (jobId) => sandbox.getCommandJob(jobId),
    getCommandJobOutput: (jobId) => sandbox.getCommandJobOutput(jobId),
    cancelCommandJob: (jobId) => sandbox.cancelCommandJob(jobId),
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

export async function createHostedSandboxTools(
  input: HostedSandboxToolsOptions,
): Promise<HostedSandboxToolsResult> {
  const sandbox = createHostedSandboxClient(input);
  const shellTools = await createSandboxShellTools(sandbox, input.createBashTool);

  const tools: SandboxShellToolSet = {
    ...shellTools,
    start_command_job: tool({
      description:
        "Start a long-running sandbox command as an async job. Use this instead of bash for durable shell operations.",
      inputSchema: z.object({
        command: z.string().describe("Single shell command to run asynchronously in the sandbox"),
      }),
      execute: async ({ command }) => await sandbox.startCommandJob(command),
    }),
    get_command_job: tool({
      description:
        "Get the current status for an async sandbox command job. Use this for polling while a long-running job is still running.",
      inputSchema: z.object({
        jobId: z.string().describe("Sandbox command job ID"),
      }),
      execute: async ({ jobId }) => await sandbox.getCommandJob(jobId),
    }),
    get_command_job_output: tool({
      description:
        "Get the captured stdout/stderr and terminal metadata for an async sandbox command job. Prefer calling this after the job reaches a terminal state.",
      inputSchema: z.object({
        jobId: z.string().describe("Sandbox command job ID"),
      }),
      execute: async ({ jobId }) => await sandbox.getCommandJobOutput(jobId),
    }),
    cancel_command_job: tool({
      description: "Cancel a running async sandbox command job.",
      inputSchema: z.object({
        jobId: z.string().describe("Sandbox command job ID"),
      }),
      execute: async ({ jobId }) => await sandbox.cancelCommandJob(jobId),
    }),
  };

  return {
    tools,
    sandbox,
    closeSandbox: () => sandbox.close(),
  };
}
