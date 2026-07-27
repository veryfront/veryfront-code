import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const MAX_ELICITATION_MESSAGE_LENGTH = 8_192;
const MAX_ELICITATION_ID_LENGTH = 255;
const MAX_ELICITATION_URL_LENGTH = 8_192;
const SUPPORTED_STRING_FORMATS = new Set([
  "email",
  "uri",
  "date",
  "date-time",
]);
const ROOT_SCHEMA_KEYS = new Set([
  "$schema",
  "type",
  "properties",
  "required",
]);
const STRING_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "default",
]);
const ENUM_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "enum",
  "enumNames",
  "default",
]);
const TITLED_ENUM_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "oneOf",
  "default",
]);
const NUMBER_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "minimum",
  "maximum",
  "default",
]);
const BOOLEAN_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "default",
]);
const ARRAY_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "minItems",
  "maxItems",
  "items",
  "default",
]);
const UNTITLED_ARRAY_ITEM_KEYS = new Set(["type", "enum"]);
const TITLED_ARRAY_ITEM_KEYS = new Set(["anyOf"]);
const TITLED_ENUM_OPTION_KEYS = new Set(["const", "title"]);

type JsonObject = { [key: string]: BoundedJsonValue };

function assertNonEmptyText(
  value: string,
  name: string,
  maxLength: number,
): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `Elicitation ${name} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
}

function schemaError(detail: string): never {
  throw new TypeError(`Elicitation schema ${detail}`);
}

function asSchemaObject(
  value: BoundedJsonValue | undefined,
  path: string,
): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return schemaError(`${path} must be an object`);
  }
  return value;
}

function assertAllowedKeys(
  value: JsonObject,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      schemaError(`${path} contains unsupported keyword "${key}"`);
    }
  }
}

function assertOptionalString(
  value: JsonObject,
  key: string,
  path: string,
): void {
  if (value[key] !== undefined && typeof value[key] !== "string") {
    schemaError(`${path}.${key} must be a string`);
  }
}

function readNonNegativeInteger(
  value: JsonObject,
  key: string,
  path: string,
): number | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 0
  ) {
    schemaError(`${path}.${key} must be a non-negative safe integer`);
  }
  return candidate;
}

function readFiniteNumber(
  value: JsonObject,
  key: string,
  path: string,
): number | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    schemaError(`${path}.${key} must be a finite number`);
  }
  return candidate;
}

function readStrings(
  value: BoundedJsonValue | undefined,
  path: string,
  allowEmpty: boolean,
  unique: boolean,
): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    schemaError(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
  }
  const strings = value as string[];
  if (unique && new Set(strings).size !== strings.length) {
    schemaError(`${path} must not contain duplicate values`);
  }
  return strings;
}

function assertCommonPropertyMetadata(
  property: JsonObject,
  path: string,
): void {
  assertOptionalString(property, "title", path);
  assertOptionalString(property, "description", path);
}

function validateStringProperty(property: JsonObject, path: string): void {
  if ("enum" in property) {
    assertAllowedKeys(
      property,
      ENUM_SCHEMA_KEYS,
      path,
    );
    const values = readStrings(property.enum, `${path}.enum`, false, true);
    if (property.enumNames !== undefined) {
      const names = readStrings(
        property.enumNames,
        `${path}.enumNames`,
        false,
        false,
      );
      if (names.length !== values.length) {
        schemaError(`${path}.enumNames must match the enum value count`);
      }
    }
    if (
      property.default !== undefined &&
      (
        typeof property.default !== "string" ||
        !values.includes(property.default)
      )
    ) {
      schemaError(`${path}.default must be one of the enum values`);
    }
    return;
  }

  if ("oneOf" in property) {
    assertAllowedKeys(
      property,
      TITLED_ENUM_SCHEMA_KEYS,
      path,
    );
    if (!Array.isArray(property.oneOf) || property.oneOf.length === 0) {
      schemaError(`${path}.oneOf must be a non-empty array`);
    }
    const values: string[] = [];
    for (const [index, rawOption] of property.oneOf.entries()) {
      const optionPath = `${path}.oneOf[${index}]`;
      const option = asSchemaObject(rawOption, optionPath);
      assertAllowedKeys(option, TITLED_ENUM_OPTION_KEYS, optionPath);
      if (
        typeof option.const !== "string" ||
        typeof option.title !== "string"
      ) {
        schemaError(`${optionPath} must contain string const and title fields`);
      }
      values.push(option.const);
    }
    if (new Set(values).size !== values.length) {
      schemaError(`${path}.oneOf must not contain duplicate const values`);
    }
    if (
      property.default !== undefined &&
      (
        typeof property.default !== "string" ||
        !values.includes(property.default)
      )
    ) {
      schemaError(`${path}.default must match a oneOf const value`);
    }
    return;
  }

  assertAllowedKeys(
    property,
    STRING_SCHEMA_KEYS,
    path,
  );
  const minLength = readNonNegativeInteger(property, "minLength", path);
  const maxLength = readNonNegativeInteger(property, "maxLength", path);
  if (
    minLength !== undefined &&
    maxLength !== undefined &&
    minLength > maxLength
  ) {
    schemaError(`${path}.minLength must not exceed maxLength`);
  }
  assertOptionalString(property, "pattern", path);
  if (
    property.format !== undefined &&
    (
      typeof property.format !== "string" ||
      !SUPPORTED_STRING_FORMATS.has(property.format)
    )
  ) {
    schemaError(`${path}.format is not supported`);
  }
  if (property.default !== undefined && typeof property.default !== "string") {
    schemaError(`${path}.default must be a string`);
  }
}

function validateNumberProperty(property: JsonObject, path: string): void {
  assertAllowedKeys(
    property,
    NUMBER_SCHEMA_KEYS,
    path,
  );
  const minimum = readFiniteNumber(property, "minimum", path);
  const maximum = readFiniteNumber(property, "maximum", path);
  const defaultValue = readFiniteNumber(property, "default", path);
  if (
    minimum !== undefined &&
    maximum !== undefined &&
    minimum > maximum
  ) {
    schemaError(`${path}.minimum must not exceed maximum`);
  }
  if (
    property.type === "integer" &&
    defaultValue !== undefined &&
    !Number.isSafeInteger(defaultValue)
  ) {
    schemaError(`${path}.default must be a safe integer`);
  }
  if (
    defaultValue !== undefined &&
    (
      (minimum !== undefined && defaultValue < minimum) ||
      (maximum !== undefined && defaultValue > maximum)
    )
  ) {
    schemaError(`${path}.default must satisfy the numeric bounds`);
  }
}

function validateBooleanProperty(property: JsonObject, path: string): void {
  assertAllowedKeys(
    property,
    BOOLEAN_SCHEMA_KEYS,
    path,
  );
  if (property.default !== undefined && typeof property.default !== "boolean") {
    schemaError(`${path}.default must be a boolean`);
  }
}

function validateArrayProperty(property: JsonObject, path: string): void {
  assertAllowedKeys(
    property,
    ARRAY_SCHEMA_KEYS,
    path,
  );
  const minItems = readNonNegativeInteger(property, "minItems", path);
  const maxItems = readNonNegativeInteger(property, "maxItems", path);
  if (
    minItems !== undefined &&
    maxItems !== undefined &&
    minItems > maxItems
  ) {
    schemaError(`${path}.minItems must not exceed maxItems`);
  }

  const items = asSchemaObject(property.items, `${path}.items`);
  let values: string[];
  if ("enum" in items) {
    assertAllowedKeys(items, UNTITLED_ARRAY_ITEM_KEYS, `${path}.items`);
    if (items.type !== "string") {
      schemaError(`${path}.items.type must be "string"`);
    }
    values = readStrings(items.enum, `${path}.items.enum`, false, true);
  } else {
    assertAllowedKeys(items, TITLED_ARRAY_ITEM_KEYS, `${path}.items`);
    if (!Array.isArray(items.anyOf) || items.anyOf.length === 0) {
      schemaError(`${path}.items.anyOf must be a non-empty array`);
    }
    values = [];
    for (const [index, rawOption] of items.anyOf.entries()) {
      const optionPath = `${path}.items.anyOf[${index}]`;
      const option = asSchemaObject(rawOption, optionPath);
      assertAllowedKeys(option, TITLED_ENUM_OPTION_KEYS, optionPath);
      if (
        typeof option.const !== "string" ||
        typeof option.title !== "string"
      ) {
        schemaError(`${optionPath} must contain string const and title fields`);
      }
      values.push(option.const);
    }
    if (new Set(values).size !== values.length) {
      schemaError(`${path}.items.anyOf must not contain duplicate const values`);
    }
  }

  if (property.default !== undefined) {
    const defaults = readStrings(
      property.default,
      `${path}.default`,
      true,
      false,
    );
    if (defaults.some((entry) => !values.includes(entry))) {
      schemaError(`${path}.default must contain only declared enum values`);
    }
    if (
      (minItems !== undefined && defaults.length < minItems) ||
      (maxItems !== undefined && defaults.length > maxItems)
    ) {
      schemaError(`${path}.default must satisfy the item-count bounds`);
    }
  }
}

function validatePrimitiveProperty(
  rawProperty: BoundedJsonValue,
  path: string,
): void {
  const property = asSchemaObject(rawProperty, path);
  assertCommonPropertyMetadata(property, path);
  switch (property.type) {
    case "string":
      validateStringProperty(property, path);
      return;
    case "number":
    case "integer":
      validateNumberProperty(property, path);
      return;
    case "boolean":
      validateBooleanProperty(property, path);
      return;
    case "array":
      validateArrayProperty(property, path);
      return;
    default:
      schemaError(`${path}.type must be a supported primitive type`);
  }
}

function validateFormSchema(schema: JsonObject): void {
  assertAllowedKeys(
    schema,
    ROOT_SCHEMA_KEYS,
    "root",
  );
  assertOptionalString(schema, "$schema", "root");
  if (schema.type !== "object") {
    schemaError('root.type must be "object"');
  }
  const properties = asSchemaObject(schema.properties, "root.properties");
  for (const [name, property] of Object.entries(properties)) {
    validatePrimitiveProperty(property, `root.properties.${JSON.stringify(name)}`);
  }
  if (schema.required !== undefined) {
    const required = readStrings(
      schema.required,
      "root.required",
      true,
      true,
    );
    for (const name of required) {
      if (!Object.hasOwn(properties, name)) {
        schemaError(`root.required references undeclared property "${name}"`);
      }
    }
  }
}

/** Options accepted by form elicitation. */
export interface FormElicitationOptions {
  message: string;
  schema: Record<string, unknown>;
}

/** Options accepted by URL elicitation. */
export interface UrlElicitationOptions {
  message: string;
  url: string;
  elicitationId: string;
}

/** Request payload for elicitation. */
export interface ElicitationRequest {
  method: "elicitation/create";
  params: Record<string, unknown>;
}

/** Builds form elicitation. */
export function buildFormElicitation(
  options: FormElicitationOptions,
): ElicitationRequest {
  assertNonEmptyText(
    options.message,
    "message",
    MAX_ELICITATION_MESSAGE_LENGTH,
  );
  const schemaSnapshot = snapshotBoundedJsonValue(options.schema);
  if (
    !schemaSnapshot.success ||
    schemaSnapshot.value === null ||
    typeof schemaSnapshot.value !== "object" ||
    Array.isArray(schemaSnapshot.value)
  ) {
    throw new TypeError(
      "Elicitation schema must be a bounded, data-only JSON object",
    );
  }
  validateFormSchema(schemaSnapshot.value);

  return {
    method: "elicitation/create",
    params: {
      mode: "form",
      message: options.message,
      requestedSchema: schemaSnapshot.value,
    },
  };
}

/** Builds URL elicitation. */
export function buildUrlElicitation(
  options: UrlElicitationOptions,
): ElicitationRequest {
  assertNonEmptyText(
    options.message,
    "message",
    MAX_ELICITATION_MESSAGE_LENGTH,
  );
  assertNonEmptyText(
    options.elicitationId,
    "elicitationId",
    MAX_ELICITATION_ID_LENGTH,
  );
  if (
    typeof options.url !== "string" ||
    options.url.length === 0 ||
    options.url.length > MAX_ELICITATION_URL_LENGTH
  ) {
    throw new TypeError("Elicitation URL must be a valid HTTP(S) URL");
  }
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new TypeError("Elicitation URL must be a valid HTTP(S) URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError(
      "Elicitation URL must be a valid HTTP(S) URL without embedded credentials",
    );
  }

  return {
    method: "elicitation/create",
    params: {
      mode: "url",
      message: options.message,
      url: url.toString(),
      elicitationId: options.elicitationId,
    },
  };
}
