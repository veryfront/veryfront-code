import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import type { ToolSet } from "#veryfront/tool/index.ts";

const scopes = createPrivateAsyncLocalStorage<{ active: boolean; tools: Map<string, unknown> }>();
const entries = Object.entries;

/** Local eval fixtures may replace reserved tools without acquiring host provenance. */
export async function runWithEvalMockToolScope<T>(
  tools: ToolSet,
  run: () => Promise<T>,
): Promise<T> {
  const scope = { active: true, tools: createPrivateMap<string, unknown>() };
  for (const [name, tool] of entries(tools)) scope.tools.set(name, tool);
  try {
    return await scopes.run(scope, run);
  } finally {
    scope.active = false;
    scope.tools.clear();
  }
}

export function isActiveEvalMockTool(name: string, tool: unknown): boolean {
  const scope = scopes.getStore();
  return scope?.active === true && tool !== undefined && scope.tools.get(name) === tool;
}
