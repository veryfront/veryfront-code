import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import catalog from "./contracts/target-catalog.json" with { type: "json" };
import envelopeSchema from "./contracts/target-envelope.schema.json" with { type: "json" };
import payloadExamples from "./contracts/target-payload-examples.json" with { type: "json" };
import payloadSchemas from "./contracts/target-payload-schemas.json" with { type: "json" };

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const PARSER_ENVELOPE_SCHEMA = deepFreeze(structuredClone(envelopeSchema)) as JsonSchema;
const PARSER_PAYLOAD_SCHEMAS = deepFreeze(structuredClone(payloadSchemas)) as JsonSchema;

export const AGENT_EVENT_TARGET_CATALOG = deepFreeze(structuredClone(catalog));
export const AGENT_EVENT_TARGET_ENVELOPE_SCHEMA = deepFreeze(
  structuredClone(envelopeSchema),
) as JsonSchema;
export const AGENT_EVENT_TARGET_PAYLOAD_SCHEMAS = deepFreeze(
  structuredClone(payloadSchemas),
) as JsonSchema;
export const AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES = deepFreeze(structuredClone(payloadExamples));

export function cloneAgentEventTargetParserSchemas(): {
  envelopeSchema: JsonSchema;
  payloadSchemas: JsonSchema;
} {
  return {
    envelopeSchema: structuredClone(PARSER_ENVELOPE_SCHEMA),
    payloadSchemas: structuredClone(PARSER_PAYLOAD_SCHEMAS),
  };
}
