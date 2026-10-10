import { posix } from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { CreateSandboxShellToolsInput } from "veryfront/extensions/sandbox";

const MAX_OUTPUT_LENGTH = 30_000;

function truncateOutput(output: string, stream: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n\n[${stream} truncated: ${
    output.length - MAX_OUTPUT_LENGTH
  } characters removed]`;
}

/** Create tools for the supplied sandbox without local file discovery. */
export function createBashTool(input: CreateSandboxShellToolsInput): { tools: ToolSet } {
  const { sandbox, destination, promptOptions } = input;
  const tools = {
    bash: tool({
      description: [
        "Execute bash commands in the sandbox environment.",
        "",
        `WORKING DIRECTORY: ${destination}`,
        "All commands execute from this directory. Use relative paths from here.",
        "",
        promptOptions.toolPrompt,
        "",
        "Use ls to list files, find to locate files, grep to search, and cat to read files.",
      ].join("\n").trim(),
      inputSchema: z.object({
        command: z.string().describe("The bash command to execute"),
      }),
      execute: async ({ command }) => {
        const result = await sandbox.runCommand(
          `cd "${destination}" && ${command}`,
        ) as { stdout: string; stderr: string; exitCode: number };
        return {
          ...result,
          stdout: truncateOutput(result.stdout, "stdout"),
          stderr: truncateOutput(result.stderr, "stderr"),
        };
      },
    }),
    readFile: tool({
      description: "Read the contents of a file from the sandbox.",
      inputSchema: z.object({
        path: z.string().describe("The path to the file to read"),
      }),
      execute: async ({ path }) => {
        if (!sandbox.readFile) throw new Error("Sandbox does not support reading files");
        const content = await sandbox.readFile(posix.resolve(destination, path));
        return { content };
      },
    }),
    writeFile: tool({
      description: "Write content to a file in the sandbox. Creates parent directories if needed.",
      inputSchema: z.object({
        path: z.string().describe("The path where the file should be written"),
        content: z.string().describe("The content to write to the file"),
      }),
      execute: async ({ path, content }) => {
        if (!sandbox.writeFiles) throw new Error("Sandbox does not support writing files");
        await sandbox.writeFiles([{ path: posix.resolve(destination, path), content }]);
        return { success: true };
      },
    }),
  };
  return { tools };
}
