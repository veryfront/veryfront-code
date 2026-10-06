import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  assertEventSchemaValidator,
  getEventSchemaValidatorVersion,
} from "#veryfront/events/schema-validator.ts";
import { AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-run-paused-contract.ts";
import type { AgUiNativeRunPausedRecord } from "#veryfront/events/ag-ui/native-run-paused-types.generated.ts";
export {
  AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA,
  AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA,
  AG_UI_NATIVE_RUN_PAUSED_SCHEMA_ID,
  AG_UI_NATIVE_RUN_PAUSED_TYPE,
  AG_UI_PROTOCOL_EXTENSION_URI,
} from "#veryfront/events/ag-ui/native-run-paused-contract.ts";
export type {
  AgUiNativeRunPausedDataschema,
  AgUiNativeRunPausedPayload,
  AgUiNativeRunPausedProtocolMetadata,
  AgUiNativeRunPausedRecord,
  AgUiNativeRunPausedType,
} from "#veryfront/events/ag-ui/native-run-paused-types.generated.ts";

let compiledValidator: JsonSchemaValidationFunction<AgUiNativeRunPausedRecord> | undefined;
let compiledValidatorVersion = -1;

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgUiNativeRunPausedRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeRunPausedRecord>>,
): value is PromiseLike<JsonSchemaValidationResult<AgUiNativeRunPausedRecord>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgUiNativeRunPausedRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeRunPausedRecord>>,
): JsonSchemaValidationResult<AgUiNativeRunPausedRecord> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError("AG-UI native run.paused requires a synchronous JSON Schema validator");
  }
  return result;
}

function validator(): JsonSchemaValidationFunction<AgUiNativeRunPausedRecord> {
  const version = getEventSchemaValidatorVersion();
  if (compiledValidator && compiledValidatorVersion === version) return compiledValidator;
  const schemaValidator = assertEventSchemaValidator();
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError("AG-UI native run.paused requires compileJsonSchema support");
  }
  compiledValidator = schemaValidator.compileJsonSchema<AgUiNativeRunPausedRecord>(
    AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA,
  );
  compiledValidatorVersion = version;
  return compiledValidator;
}

export function parseNativeRunPausedRecord(input: unknown): AgUiNativeRunPausedRecord {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) {
    throw new TypeError("native run.paused event must be bounded data-only JSON");
  }
  const result = validationResultSync(validator()(snapshot.value));
  if (!result.success) {
    const first = result.errors[0];
    const suffix = first?.message ? `: ${first.message}` : "";
    throw new TypeError(`Invalid native run.paused event${suffix}`);
  }
  return result.value;
}
