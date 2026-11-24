import type { BrokerRuntimeAgentExecutorInput } from "./broker-ingress.ts";
import { getRuntimeAgentMarkdownDefinitionSchema } from "../runtime/agent-definition.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

/** Validate a definition read from the authenticated immutable source executor. */
export function readCanonicalSourceDefinition(
  executor: BrokerRuntimeAgentExecutorInput,
  definition: unknown,
) {
  const snapshot = snapshotBoundedJsonValue(definition);
  if (!snapshot.success) throw new TypeError("Canonical source definition is required");
  const parsed = getRuntimeAgentMarkdownDefinitionSchema().safeParse(snapshot.value);
  if (!parsed.success || parsed.data.id !== executor.run.agentId) {
    throw new TypeError("Canonical source definition does not match the selected agent");
  }
  return parsed.data;
}
