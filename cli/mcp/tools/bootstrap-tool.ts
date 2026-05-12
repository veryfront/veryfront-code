/**
 * MCP tool: vf_bootstrap
 *
 * Returns everything an agent needs at session start in a single call:
 * project context, coding conventions, current errors, and server status.
 */

import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "veryfront/mcp";
import { type DevError, getErrorCollector } from "veryfront/observability";
import { vfGetProjectContext } from "./project-tools.ts";
import { vfGetConventions } from "./scaffold-tools.ts";

const getBootstrapInput = defineSchema((v) =>
  v.object({
    projectPath: v.string().optional().describe(
      "Project directory (defaults to current working directory)",
    ),
  })
);
const bootstrapInput = getBootstrapInput();

type BootstrapInput = InferSchema<ReturnType<typeof getBootstrapInput>>;

interface BootstrapResult {
  project: Awaited<ReturnType<typeof vfGetProjectContext.execute>>;
  conventions: Awaited<ReturnType<typeof vfGetConventions.execute>>;
  errors: { total: number; items: DevError[] };
  status: { running: boolean };
}

export const vfBootstrap: MCPTool<BootstrapInput, BootstrapResult> = {
  name: "vf_bootstrap",
  title: "Bootstrap",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: "Use this at the start of a new session to get full project context in one call. " +
    "Returns project structure, coding conventions, current errors, and server status. " +
    "Equivalent to calling vf_get_project_context + vf_get_conventions + vf_get_errors + " +
    "vf_get_status separately, but in a single round-trip. " +
    "Do not use repeatedly — call once at session bootstrap.",
  inputSchema: bootstrapInput,
  execute: async (input) => {
    const [project, conventions] = await Promise.all([
      vfGetProjectContext.execute({ projectPath: input.projectPath }),
      vfGetConventions.execute({ topic: "all" }),
    ]);

    let errors: DevError[] = [];
    let running = false;
    try {
      const collector = getErrorCollector();
      errors = collector.getAll();
      running = true;
    } catch {
      running = false;
    }

    return {
      project,
      conventions,
      errors: { total: errors.length, items: errors.slice(-20) },
      status: { running },
    };
  },
};
