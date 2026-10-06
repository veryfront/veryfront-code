import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
  SchemaValidator,
} from "#veryfront/extensions/schema/index.ts";
import {
  assertEventSchemaValidator,
  getEventSchemaValidatorVersion,
} from "#veryfront/events/schema-validator.ts";
import { AG_UI_EVENT_SCHEMA } from "#veryfront/events/ag-ui/schema.ts";
import type {
  AgUiEvent,
  AgUiParser,
  AgUiParseResult,
  AgUiRunAgentInput,
} from "#veryfront/events/ag-ui/types.ts";

let compiledAgUiEventValidator: JsonSchemaValidationFunction<AgUiEvent> | undefined;
let compiledAgUiEventValidatorVersion = -1;

function compileAgUiEventValidator(
  schemaValidator: SchemaValidator,
): JsonSchemaValidationFunction<AgUiEvent> {
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError(
      "veryfront/events AG-UI support requires a SchemaValidator implementation with compileJsonSchema support",
    );
  }
  return schemaValidator.compileJsonSchema<AgUiEvent>(AG_UI_EVENT_SCHEMA);
}

function getAgUiEventValidator(): JsonSchemaValidationFunction<AgUiEvent> {
  const validatorVersion = getEventSchemaValidatorVersion();
  if (compiledAgUiEventValidator && compiledAgUiEventValidatorVersion === validatorVersion) {
    return compiledAgUiEventValidator;
  }
  compiledAgUiEventValidator = compileAgUiEventValidator(assertEventSchemaValidator());
  compiledAgUiEventValidatorVersion = validatorVersion;
  return compiledAgUiEventValidator;
}

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgUiEvent>
    | PromiseLike<JsonSchemaValidationResult<AgUiEvent>>,
): value is PromiseLike<JsonSchemaValidationResult<AgUiEvent>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgUiEvent>
    | PromiseLike<JsonSchemaValidationResult<AgUiEvent>>,
): JsonSchemaValidationResult<AgUiEvent> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError(
      "veryfront/events AG-UI support requires a synchronous JSON Schema validator",
    );
  }
  return result;
}

function safeParseAgUiEventWithValidator(
  validator: JsonSchemaValidationFunction<AgUiEvent>,
  input: unknown,
): AgUiParseResult {
  const result = validationResultSync(validator(input));
  if (!result.success) {
    return { success: false, issues: result.errors };
  }
  return { success: true, data: normalizeAgUiEventOutput(result.value) };
}

function normalizeRunAgentInputOutput(input: AgUiRunAgentInput): AgUiRunAgentInput {
  const { state, ...fields } = input;
  return {
    ...fields,
    ...(state == null ? {} : { state }),
    tools: input.tools ?? [],
    context: input.context ?? [],
  };
}

function normalizeAgUiEventOutput(event: AgUiEvent): AgUiEvent {
  if (event.type !== "RUN_STARTED" || event.input === undefined) return event;
  return {
    ...event,
    input: normalizeRunAgentInputOutput(event.input),
  };
}

function parseAgUiEventResult(result: AgUiParseResult): AgUiEvent {
  if (result.success) return result.data;
  const first = result.issues[0];
  const suffix = first?.message ? `: ${first.message}` : "";
  throw new TypeError(`Invalid AG-UI 1.0 event${suffix}`);
}

/** Create an AG-UI 1.0 parser with the supplied schema validator. */
export function createAgUiParser(schemaValidator: SchemaValidator): AgUiParser {
  const validator = compileAgUiEventValidator(schemaValidator);
  return {
    safeParseAgUiEvent(input: unknown): AgUiParseResult {
      return safeParseAgUiEventWithValidator(validator, input);
    },
    parseAgUiEvent(input: unknown): AgUiEvent {
      return parseAgUiEventResult(safeParseAgUiEventWithValidator(validator, input));
    },
  };
}

/** Validate an AG-UI event and return its value or validation issues. */
export function safeParseAgUiEvent(input: unknown): AgUiParseResult {
  return safeParseAgUiEventWithValidator(getAgUiEventValidator(), input);
}

/** Parse an AG-UI event; throw when it violates the pinned contract. */
export function parseAgUiEvent(input: unknown): AgUiEvent {
  return parseAgUiEventResult(safeParseAgUiEvent(input));
}
