import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";

export const EVENT_SCHEMA_VALIDATOR_CONTRACT = "SchemaValidator";
export const EVENT_SCHEMA_VALIDATOR_PACKAGE = "@veryfront/ext-schema-zod";

let registeredEventSchemaValidator: SchemaValidator | undefined;
let eventSchemaValidatorVersion = 0;

const REGISTRATION_GUIDANCE = [
  `veryfront/events needs a ${EVENT_SCHEMA_VALIDATOR_CONTRACT} implementation to validate Agent Events Protocol data,`,
  "and none has been registered for the events entrypoint.",
  `Add ${EVENT_SCHEMA_VALIDATOR_PACKAGE} and register it once at startup:`,
  `import { registerEventSchemaValidator } from "veryfront/events";`,
  `import { createZodAdapter } from "${EVENT_SCHEMA_VALIDATOR_PACKAGE}";`,
  "registerEventSchemaValidator(createZodAdapter());",
].join(" ");

export function registerEventSchemaValidator(validator: SchemaValidator): void {
  if (validator === undefined || validator === null) {
    throw new TypeError("Agent Events Protocol schema validator must not be null or undefined");
  }
  registeredEventSchemaValidator = validator;
  eventSchemaValidatorVersion += 1;
}

export function unregisterEventSchemaValidator(): void {
  registeredEventSchemaValidator = undefined;
  eventSchemaValidatorVersion += 1;
}

export function tryResolveEventSchemaValidator(): SchemaValidator | undefined {
  return registeredEventSchemaValidator;
}

export function getEventSchemaValidatorVersion(): number {
  return eventSchemaValidatorVersion;
}

export function assertEventSchemaValidator(): SchemaValidator {
  const validator = registeredEventSchemaValidator;
  if (!validator) {
    throw new TypeError(REGISTRATION_GUIDANCE);
  }
  if (!validator.compileJsonSchema) {
    throw new TypeError(
      `veryfront/events needs a ${EVENT_SCHEMA_VALIDATOR_CONTRACT} implementation with compileJsonSchema support. Use ${EVENT_SCHEMA_VALIDATOR_PACKAGE} or another validator that implements compileJsonSchema.`,
    );
  }
  return validator;
}
