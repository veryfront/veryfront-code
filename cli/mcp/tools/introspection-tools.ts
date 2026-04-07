import { z } from "zod";
import type { MCPTool } from "veryfront/mcp";
import { generateCommandSchema, generateSchema } from "../../commands/schema/command.ts";
import type { CommandCategory } from "../../help/types.ts";
import { VERSION } from "#cli/utils";

const getSchemaInput = z.object({
  command: z.string().optional().describe("Get schema for a specific command"),
  category: z.string().optional().describe("Filter by category"),
});

const vfGetSchema: MCPTool = {
  name: "vf_get_schema",
  title: "Get CLI Schema",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to discover available CLI commands, their arguments, and flags. Do not use for project info — use vf_get_project_info instead.",
  inputSchema: getSchemaInput,
  execute: async (input: { command?: string; category?: string }) => {
    if (input.command) {
      return generateCommandSchema(input.command) ?? { error: `Unknown command: ${input.command}` };
    }
    return generateSchema(input.category as CommandCategory | undefined);
  },
};

const getProjectInfoInput = z.object({});

const vfGetProjectInfo: MCPTool = {
  name: "vf_get_project_info",
  title: "Get Project Info",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need project metadata including project slug, version, and environment. Do not use for CLI commands — use vf_get_schema instead.",
  inputSchema: getProjectInfoInput,
  execute: async () => {
    const { getEnvironmentConfig } = await import("veryfront/config");
    const config = getEnvironmentConfig();
    return {
      version: VERSION,
      projectSlug: config.projectSlug ?? null,
      nodeEnv: config.nodeEnv,
      veryfrontEnv: config.veryfrontEnv,
    };
  },
};

export const introspectionTools: MCPTool[] = [
  vfGetSchema,
  vfGetProjectInfo,
];
