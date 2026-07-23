import { getRuntimeAgentRunIdSchema } from "#veryfront/agent/runtime/agent-invocation-contract.ts";

/** Result of matching and validating one control-plane run path. */
export type ControlPlaneRunPathResult =
  | { matched: false; runId: null }
  | { matched: true; runId: string | null };

/** Decode and validate the run identifier captured by a route pattern. */
export function parseControlPlaneRunPath(
  pathname: string,
  pattern: RegExp,
): ControlPlaneRunPathResult {
  const match = pattern.exec(pathname);
  if (!match) return { matched: false, runId: null };

  try {
    const parsed = getRuntimeAgentRunIdSchema().safeParse(
      decodeURIComponent(match[1] ?? ""),
    );
    return { matched: true, runId: parsed.success ? parsed.data : null };
  } catch {
    return { matched: true, runId: null };
  }
}
