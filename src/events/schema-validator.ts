import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";

export const AGENT_EVENT_SCHEMA_VALIDATOR_CONTRACT = "SchemaValidator";
export const AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE = "@veryfront/ext-schema-zod";

let registeredAgentEventSchemaValidator: SchemaValidator | undefined;
let agentEventSchemaValidatorVersion = 0;

const REGISTRATION_GUIDANCE = [
  `veryfront/events needs a ${AGENT_EVENT_SCHEMA_VALIDATOR_CONTRACT} implementation to validate Agent Events Protocol data,`,
  "and none has been registered for the events entrypoint.",
  `Add ${AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE} and register it once at startup:`,
  `import { registerAgentEventSchemaValidator } from "veryfront/events";`,
  `import { createZodAdapter } from "${AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE}";`,
  "registerAgentEventSchemaValidator(createZodAdapter());",
].join(" ");

export function registerAgentEventSchemaValidator(validator: SchemaValidator): void {
  if (validator === undefined || validator === null) {
    throw new TypeError("Agent Events Protocol schema validator must not be null or undefined");
  }
  registeredAgentEventSchemaValidator = validator;
  agentEventSchemaValidatorVersion += 1;
}

export function unregisterAgentEventSchemaValidator(): void {
  registeredAgentEventSchemaValidator = undefined;
  agentEventSchemaValidatorVersion += 1;
}

export function tryResolveAgentEventSchemaValidator(): SchemaValidator | undefined {
  return registeredAgentEventSchemaValidator;
}

export function getAgentEventSchemaValidatorVersion(): number {
  return agentEventSchemaValidatorVersion;
}

export function assertAgentEventSchemaValidator(): SchemaValidator {
  const validator = registeredAgentEventSchemaValidator;
  if (!validator) {
    throw new TypeError(REGISTRATION_GUIDANCE);
  }
  if (!validator.compileJsonSchema) {
    throw new TypeError(
      `veryfront/events needs a ${AGENT_EVENT_SCHEMA_VALIDATOR_CONTRACT} implementation with compileJsonSchema support. Use ${AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE} or another validator that implements compileJsonSchema.`,
    );
  }
  return validator;
}
