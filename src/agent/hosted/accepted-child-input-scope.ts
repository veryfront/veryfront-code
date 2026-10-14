import type { HostedAcceptedChildEvidence } from "./accepted-child-evidence.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostedAcceptedTaskInputEvent } from "./accepted-task-input.ts";
export type HostedChildTaskInputResolver = (
  input: Readonly<
    {
      projectId: string;
      rootRunId?: string;
      parentRunId: string;
      targetAgentId: string;
      toolCallId: string;
      evidence: HostedAcceptedChildEvidence;
    }
  >,
) => Promise<Omit<HostedAcceptedTaskInputEvent, "type" | "version" | "targetAgentId"> | undefined>;
type Scope = { active: boolean; resolver: HostedChildTaskInputResolver };
const storage = new AsyncLocalStorage<Scope | undefined>();
/** Application-owned deterministic receipt selection, scoped to one active parent execution. */
export async function withHostedChildTaskInputResolver<T>(
  resolver: HostedChildTaskInputResolver | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!resolver) return storage.run(undefined, operation);
  const scope = { active: true, resolver };
  try {
    return await storage.run(scope, operation);
  } finally {
    scope.active = false;
  }
}
export function getHostedChildTaskInputResolver(): HostedChildTaskInputResolver | undefined {
  const scope = storage.getStore();
  if (!scope?.active) return undefined;
  const resolver = scope.resolver;
  return async (input) => {
    if (!scope.active) throw new Error("Accepted child input resolver is no longer active");
    const accepted = await resolver(input);
    if (!scope.active) throw new Error("Accepted child input resolver is no longer active");
    return accepted;
  };
}
