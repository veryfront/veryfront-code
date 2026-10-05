import type {
  JsonSchema,
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
  SchemaValidator,
} from "#veryfront/extensions/schema/index.ts";
import { cloneAgentEventTargetParserSchemas } from "./contracts.ts";
import {
  assertAgentEventSchemaValidator,
  getAgentEventSchemaValidatorVersion,
} from "./schema-validator.ts";
import type { AgentEvent, AgentEventParseIssue, AgentEventParseResult } from "./types.ts";

const TARGET_PAYLOAD_SCHEMA_ID = "urn:veryfront:run-events:target:payloads:1";
const LOCAL_REF_PREFIX = `${TARGET_PAYLOAD_SCHEMA_ID}#/$defs/`;
const LOCAL_REF_REPLACEMENT_PREFIX = "#/$defs/";

let compiledAgentEventValidator: JsonSchemaValidationFunction<AgentEvent> | undefined;
let compiledAgentEventValidatorVersion = -1;

export interface AgentEventParser {
  safeParseAgentEvent(input: unknown): AgentEventParseResult;
  parseAgentEvent(input: unknown): AgentEvent;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSchemaForRuntime(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSchemaForRuntime(item));
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.startsWith("x-")) continue;
    if (key === "format" && (raw === "ce-string" || raw === "w3c-tracestate")) {
      continue;
    }
    if (key === "$ref" && typeof raw === "string" && raw.startsWith(LOCAL_REF_PREFIX)) {
      normalized[key] = `${LOCAL_REF_REPLACEMENT_PREFIX}${raw.slice(LOCAL_REF_PREFIX.length)}`;
      continue;
    }
    normalized[key] = normalizeSchemaForRuntime(raw);
  }
  if (
    normalized.type === undefined &&
    normalized.$ref === undefined &&
    normalized.const === undefined &&
    normalized.enum === undefined &&
    (
      normalized.properties !== undefined ||
      normalized.required !== undefined ||
      normalized.additionalProperties !== undefined ||
      normalized.propertyNames !== undefined
    )
  ) {
    normalized.type = "object";
  }
  return normalized;
}

function targetEnvelopeSchemaForRuntime(): JsonSchema {
  const { envelopeSchema, payloadSchemas } = cloneAgentEventTargetParserSchemas();
  const envelope = normalizeSchemaForRuntime(envelopeSchema);
  const payloads = normalizeSchemaForRuntime(payloadSchemas);
  if (
    !isPlainRecord(envelope) ||
    !isPlainRecord(envelope.properties) ||
    !isPlainRecord(payloads) ||
    !isPlainRecord(payloads.$defs)
  ) {
    throw new TypeError("Agent Events Protocol schema artifacts are malformed");
  }
  const schema = { ...envelope, $defs: payloads.$defs };
  patchStrictRequiredBranches(schema, envelope.properties);
  return schema as JsonSchema;
}

function patchStrictRequiredBranches(
  value: unknown,
  availableProperties: Record<string, unknown>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) patchStrictRequiredBranches(item, availableProperties);
    return;
  }
  if (!isPlainRecord(value)) return;

  const localProperties = isPlainRecord(value.properties)
    ? { ...availableProperties, ...value.properties }
    : availableProperties;
  if (Array.isArray(value.required)) {
    const properties = isPlainRecord(value.properties) ? value.properties : {};
    let patchedProperties: Record<string, unknown> | undefined;
    for (const requiredKey of value.required) {
      if (
        typeof requiredKey === "string" &&
        properties[requiredKey] === undefined
      ) {
        patchedProperties ??= { ...properties };
        patchedProperties[requiredKey] = localProperties[requiredKey] ?? {};
      }
    }
    if (patchedProperties) value.properties = patchedProperties;
  }

  for (const child of Object.values(value)) {
    patchStrictRequiredBranches(child, localProperties);
  }
}

function compileAgentEventValidator(
  schemaValidator: SchemaValidator,
): JsonSchemaValidationFunction<AgentEvent> {
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError(
      "veryfront/events requires a SchemaValidator implementation with compileJsonSchema support",
    );
  }
  return schemaValidator.compileJsonSchema<AgentEvent>(targetEnvelopeSchemaForRuntime());
}

function getAgentEventValidator(): JsonSchemaValidationFunction<AgentEvent> {
  const validatorVersion = getAgentEventSchemaValidatorVersion();
  if (compiledAgentEventValidator && compiledAgentEventValidatorVersion === validatorVersion) {
    return compiledAgentEventValidator;
  }
  compiledAgentEventValidator = compileAgentEventValidator(assertAgentEventSchemaValidator());
  compiledAgentEventValidatorVersion = validatorVersion;
  return compiledAgentEventValidator;
}

function cloudEventsString(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) >= 0xfffe
    ) {
      return false;
    }
  }
  return true;
}

function traceState(value: string): boolean {
  if (value.length > 512) return false;
  const members = value.split(",").filter((member) => !/^[ \t]*$/.test(member));
  if (members.length === 0 || members.length > 32) return false;
  const keys = new Set<string>();
  for (const member of members) {
    const match = member.match(/^[ \t]*([^=]+)=(.*?)[ \t]*$/);
    if (!match) return false;
    const [, key, content] = match;
    if (key === undefined || content === undefined) return false;
    const simple = /^[a-z][a-z0-9_*/-]{0,255}$/;
    const multi = /^[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13}$/;
    if ((!simple.test(key) && !multi.test(key)) || keys.has(key)) return false;
    if (
      !content.length ||
      content.length > 256 ||
      !/^[\x20-\x2b\x2d-\x3c\x3e-\x7e]*[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/.test(content)
    ) {
      return false;
    }
    keys.add(key);
  }
  return true;
}

function semanticIssue(message: string, instancePath: string): AgentEventParseIssue {
  return {
    instancePath,
    schemaPath: "#/x-semantics",
    keyword: "x-semantics",
    params: {},
    message,
  };
}

function jsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function validateAgentEventSemantics(event: AgentEvent): readonly AgentEventParseIssue[] {
  const issues: AgentEventParseIssue[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === "tracestate") continue;
    if (typeof value === "string" && !cloudEventsString(value)) {
      issues.push(
        semanticIssue(
          `${key} must be a CloudEvents string`,
          `/${jsonPointerSegment(key)}`,
        ),
      );
    }
  }
  if (event.tracestate !== undefined && !traceState(event.tracestate)) {
    issues.push(semanticIssue("tracestate must follow W3C trace context syntax", "/tracestate"));
  }
  if (event.type === "com.veryfront.model-call.usage.recorded") {
    const tokens = event.data.tokens;
    if (isPlainRecord(tokens)) {
      const input = tokens.input;
      const output = tokens.output;
      if (typeof input === "number") {
        for (const key of ["cacheRead", "cacheWrite"] as const) {
          const value = tokens[key];
          if (typeof value === "number" && value > input) {
            issues.push(
              semanticIssue(`${key} must not exceed input tokens`, `/data/tokens/${key}`),
            );
          }
        }
      }
      if (typeof output === "number") {
        const reasoning = tokens.reasoning;
        if (typeof reasoning === "number" && reasoning > output) {
          issues.push(
            semanticIssue("reasoning must not exceed output tokens", "/data/tokens/reasoning"),
          );
        }
      }
    }
  }
  return issues;
}

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgentEvent>
    | PromiseLike<JsonSchemaValidationResult<AgentEvent>>,
): value is PromiseLike<JsonSchemaValidationResult<AgentEvent>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgentEvent>
    | PromiseLike<JsonSchemaValidationResult<AgentEvent>>,
): JsonSchemaValidationResult<AgentEvent> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError("veryfront/events requires a synchronous JSON Schema validator");
  }
  return result;
}

function safeParseAgentEventWithValidator(
  validator: JsonSchemaValidationFunction<AgentEvent>,
  input: unknown,
): AgentEventParseResult {
  const result = validationResultSync(validator(input));
  if (!result.success) {
    return { success: false, issues: result.errors };
  }
  const semanticIssues = validateAgentEventSemantics(result.value);
  if (semanticIssues.length > 0) {
    return { success: false, issues: semanticIssues };
  }
  return { success: true, data: result.value };
}

function parseAgentEventResult(result: AgentEventParseResult): AgentEvent {
  if (result.success) return result.data;
  const first = result.issues[0];
  const suffix = first?.message ? `: ${first.message}` : "";
  throw new TypeError(`Invalid Agent Events Protocol event${suffix}`);
}

export function createAgentEventParser(schemaValidator: SchemaValidator): AgentEventParser {
  const validator = compileAgentEventValidator(schemaValidator);
  return {
    safeParseAgentEvent(input: unknown): AgentEventParseResult {
      return safeParseAgentEventWithValidator(validator, input);
    },
    parseAgentEvent(input: unknown): AgentEvent {
      return parseAgentEventResult(safeParseAgentEventWithValidator(validator, input));
    },
  };
}

export function safeParseAgentEvent(input: unknown): AgentEventParseResult {
  return safeParseAgentEventWithValidator(getAgentEventValidator(), input);
}

export function parseAgentEvent(input: unknown): AgentEvent {
  return parseAgentEventResult(safeParseAgentEvent(input));
}
