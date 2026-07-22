import type { Tool } from "#veryfront/tool";

const AGENT_RUNTIME_LOCAL_TOOL = Symbol("veryfront.agent.runtimeLocalTool");
const AGENT_RUNTIME_LOCAL_TOOL_EXPORT_NAME = Symbol("veryfront.agent.runtimeLocalToolExportName");

type RuntimeLocalTool = Tool & {
  [AGENT_RUNTIME_LOCAL_TOOL]?: true;
  [AGENT_RUNTIME_LOCAL_TOOL_EXPORT_NAME]?: string;
};

/** Mark a framework-created tool as local to one agent runtime. */
export function markRuntimeLocalTool(tool: Tool, options?: { exportName?: string }): Tool {
  Object.defineProperty(tool, AGENT_RUNTIME_LOCAL_TOOL, {
    value: true,
    enumerable: false,
  });
  if (options?.exportName) {
    Object.defineProperty(tool, AGENT_RUNTIME_LOCAL_TOOL_EXPORT_NAME, {
      value: options.exportName,
      enumerable: false,
    });
  }
  return tool;
}

/** Check whether a tool must stay out of the project-wide tool registry. */
export function isRuntimeLocalTool(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as RuntimeLocalTool)[AGENT_RUNTIME_LOCAL_TOOL] === true,
  );
}

/** Return the project-authored tool id represented by a runtime-local tool. */
export function getRuntimeLocalToolExportName(value: unknown): string | undefined {
  if (
    value &&
    typeof value === "object" &&
    (value as RuntimeLocalTool)[AGENT_RUNTIME_LOCAL_TOOL] === true
  ) {
    return (value as RuntimeLocalTool)[AGENT_RUNTIME_LOCAL_TOOL_EXPORT_NAME];
  }
  return undefined;
}
