import type { Tool } from "#veryfront/tool";

const AGENT_RUNTIME_LOCAL_TOOL = Symbol("veryfront.agent.runtimeLocalTool");

type RuntimeLocalTool = Tool & {
  [AGENT_RUNTIME_LOCAL_TOOL]?: true;
};

/** Mark a framework-created tool as local to one agent runtime. */
export function markRuntimeLocalTool(tool: Tool): Tool {
  Object.defineProperty(tool, AGENT_RUNTIME_LOCAL_TOOL, {
    value: true,
    enumerable: false,
  });
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
