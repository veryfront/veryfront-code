import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  assertEventSchemaValidator,
  getEventSchemaValidatorVersion,
} from "#veryfront/events/schema-validator.ts";
import { AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-synchronization-contract.ts";
import type {
  AgUiNativeSynchronizationAnyRecord,
} from "#veryfront/events/ag-ui/native-synchronization-types.generated.ts";
export {
  AG_UI_NATIVE_SYNCHRONIZATION_JSON_SCHEMA,
  AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA,
  AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE,
  AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID,
  AG_UI_NATIVE_SYNCHRONIZATION_TYPES,
} from "#veryfront/events/ag-ui/native-synchronization-contract.ts";
export type {
  AgUiNativeSynchronizationAnyPayload,
  AgUiNativeSynchronizationAnyRecord,
  AgUiNativeSynchronizationDataschema,
  AgUiNativeSynchronizationPayload,
  AgUiNativeSynchronizationPayloadByType,
  AgUiNativeSynchronizationRecord,
  AgUiNativeSynchronizationType,
  AgUiSynchronizationAttribution,
  AgUiSynchronizationProtocolMetadata,
} from "#veryfront/events/ag-ui/native-synchronization-types.generated.ts";

let compiledValidator:
  | JsonSchemaValidationFunction<AgUiNativeSynchronizationAnyRecord>
  | undefined;
let compiledValidatorVersion = -1;

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgUiNativeSynchronizationAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeSynchronizationAnyRecord>>,
): value is PromiseLike<JsonSchemaValidationResult<AgUiNativeSynchronizationAnyRecord>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgUiNativeSynchronizationAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeSynchronizationAnyRecord>>,
): JsonSchemaValidationResult<AgUiNativeSynchronizationAnyRecord> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError(
      "AG-UI native synchronization requires a synchronous JSON Schema validator",
    );
  }
  return result;
}

function validator(): JsonSchemaValidationFunction<AgUiNativeSynchronizationAnyRecord> {
  const version = getEventSchemaValidatorVersion();
  if (compiledValidator && compiledValidatorVersion === version) return compiledValidator;
  const schemaValidator = assertEventSchemaValidator();
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError("AG-UI native synchronization requires compileJsonSchema support");
  }
  compiledValidator = schemaValidator.compileJsonSchema<AgUiNativeSynchronizationAnyRecord>(
    AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA,
  );
  compiledValidatorVersion = version;
  return compiledValidator;
}

export function parseNativeSynchronizationRecord(
  input: unknown,
): AgUiNativeSynchronizationAnyRecord {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) {
    throw new TypeError(`native synchronization event must be bounded data-only JSON`);
  }
  const result = validationResultSync(validator()(snapshot.value));
  if (!result.success) {
    const first = result.errors[0];
    const suffix = first?.message ? `: ${first.message}` : "";
    throw new TypeError(`Invalid native synchronization event${suffix}`);
  }
  return result.value;
}
