import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/** Options accepted by form elicitation. */
export interface FormElicitationOptions {
  /** Instruction shown to the user. */
  message: string;
  /** Bounded JSON Schema describing the requested form fields. */
  schema: Record<string, unknown>;
}

/** Options accepted by URL elicitation. */
export interface UrlElicitationOptions {
  /** Instruction shown to the user. */
  message: string;
  /** Credential-free HTTP or HTTPS URL opened by the client. */
  url: string;
  /** Stable identifier used to correlate the elicitation flow. */
  elicitationId: string;
}

/** Request payload for elicitation. */
export interface ElicitationRequest {
  /** MCP method used to create an elicitation request. */
  method: "elicitation/create";
  /** Validated mode-specific request parameters. */
  params: Record<string, unknown>;
}

const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_ELICITATION_ID_LENGTH = 255;
const MAX_ELICITATION_URL_LENGTH = 4096;
const MAX_SCHEMA_BYTES = 1024 * 1024;
const MAX_SCHEMA_PROPERTIES = 100;
const MAX_SCHEMA_TEXT_LENGTH = 4096;
const MAX_ENUM_OPTIONS = 100;
const ALLOWED_STRING_FORMATS = new Set(["email", "uri", "date", "date-time"]);
const SENSITIVE_URL_PARAMETERS = new Set([
  "accesstoken",
  "refreshtoken",
  "apikey",
  "authorization",
  "authorizationcode",
  "clientsecret",
  "credential",
  "credentials",
  "jwt",
  "password",
  "secret",
  "signature",
  "token",
  "code",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizedParameterName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveUrlParameter(value: string): boolean {
  const normalized = normalizedParameterName(value);
  return SENSITIVE_URL_PARAMETERS.has(normalized) ||
    normalized.endsWith("accesstoken") || normalized.endsWith("refreshtoken") ||
    normalized.endsWith("apikey") || normalized.endsWith("clientsecret") ||
    normalized.endsWith("password") || normalized.endsWith("secret") ||
    normalized.endsWith("signature") || normalized.endsWith("credential");
}

function hasSensitiveUrlParameters(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (isSensitiveUrlParameter(key)) return true;
  }
  return false;
}

function validateMessage(message: string): void {
  if (
    typeof message !== "string" || message.trim().length === 0 ||
    new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES ||
    hasUnsafeControlCharacters(message, true)
  ) {
    throw new TypeError(
      `The elicitation message must be non-empty, valid text of at most ${MAX_MESSAGE_BYTES} bytes`,
    );
  }
}

function validateElicitationId(id: string): void {
  if (
    typeof id !== "string" || id.length === 0 ||
    id.length > MAX_ELICITATION_ID_LENGTH ||
    hasUnsafeControlCharacters(id)
  ) {
    throw new TypeError(
      `The elicitation ID must contain 1 to ${MAX_ELICITATION_ID_LENGTH} characters without control characters`,
    );
  }
}

function validateElicitationUrl(value: string): void {
  if (typeof value !== "string" || value.length > MAX_ELICITATION_URL_LENGTH) {
    throw new TypeError("The elicitation URL is invalid");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("The elicitation URL is invalid");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" || url.password !== ""
  ) {
    throw new TypeError(
      "The elicitation URL must use HTTP or HTTPS and must not contain credentials",
    );
  }
  if (
    url.protocol === "http:" && url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1" && url.hostname !== "[::1]" &&
    url.hostname !== "::1"
  ) {
    throw new TypeError(
      "The elicitation URL must use HTTPS unless it targets a loopback host",
    );
  }
  const fragment = url.hash.slice(1);
  const fragmentParams = new URLSearchParams(
    fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment,
  );
  if (
    hasSensitiveUrlParameters(url.searchParams) ||
    hasSensitiveUrlParameters(fragmentParams)
  ) {
    throw new TypeError(
      "The elicitation URL must not contain credentials or authorization codes",
    );
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `The elicitation schema contains unsupported ${label} key '${key}'`,
      );
    }
  }
}

function isBoundedSchemaText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SCHEMA_TEXT_LENGTH &&
    !hasUnsafeControlCharacters(value);
}

function validateCommonPropertyFields(property: Record<string, unknown>): void {
  for (const key of ["title", "description"] as const) {
    if (property[key] !== undefined && !isBoundedSchemaText(property[key])) {
      throw new TypeError(`The elicitation schema ${key} must be bounded text`);
    }
  }
}

function validateStringChoices(property: Record<string, unknown>): Set<string> | undefined {
  const hasEnum = property.enum !== undefined;
  const hasOneOf = property.oneOf !== undefined;
  if (hasEnum && hasOneOf) {
    throw new TypeError("The elicitation schema cannot combine enum and oneOf");
  }

  if (hasEnum) {
    if (
      !Array.isArray(property.enum) || property.enum.length === 0 ||
      property.enum.length > MAX_ENUM_OPTIONS ||
      !property.enum.every(isBoundedSchemaText)
    ) {
      throw new TypeError("The elicitation schema enum must contain bounded strings");
    }
    const values = new Set<string>(property.enum);
    if (values.size !== property.enum.length) {
      throw new TypeError("The elicitation schema enum values must be unique");
    }
    return values;
  }

  if (hasOneOf) {
    if (
      !Array.isArray(property.oneOf) || property.oneOf.length === 0 ||
      property.oneOf.length > MAX_ENUM_OPTIONS
    ) {
      throw new TypeError("The elicitation schema oneOf must contain enum options");
    }
    const values = new Set<string>();
    for (const option of property.oneOf) {
      if (!isRecord(option)) {
        throw new TypeError("The elicitation schema oneOf options must be objects");
      }
      assertOnlyKeys(option, new Set(["const", "title"]), "oneOf option");
      if (!isBoundedSchemaText(option.const) || !isBoundedSchemaText(option.title)) {
        throw new TypeError(
          "The elicitation schema oneOf options require bounded const and title strings",
        );
      }
      values.add(option.const);
    }
    if (values.size !== property.oneOf.length) {
      throw new TypeError("The elicitation schema oneOf values must be unique");
    }
    return values;
  }
  return undefined;
}

function validateStringProperty(property: Record<string, unknown>): void {
  const hasEnum = property.enum !== undefined;
  const hasOneOf = property.oneOf !== undefined;
  if (hasEnum || hasOneOf) {
    assertOnlyKeys(
      property,
      new Set([
        "type",
        "title",
        "description",
        "default",
        ...(hasEnum ? ["enum", "enumNames"] : ["oneOf"]),
      ]),
      "string property",
    );
  } else {
    assertOnlyKeys(
      property,
      new Set([
        "type",
        "title",
        "description",
        "minLength",
        "maxLength",
        "pattern",
        "format",
        "default",
      ]),
      "string property",
    );
  }
  for (const key of ["minLength", "maxLength"] as const) {
    if (
      property[key] !== undefined &&
      (!Number.isSafeInteger(property[key]) || Number(property[key]) < 0)
    ) {
      throw new TypeError(`The elicitation schema ${key} must be a non-negative integer`);
    }
  }
  if (
    typeof property.minLength === "number" && typeof property.maxLength === "number" &&
    property.minLength > property.maxLength
  ) {
    throw new TypeError("The elicitation schema minLength must not exceed maxLength");
  }
  if (property.pattern !== undefined) {
    if (!isBoundedSchemaText(property.pattern)) {
      throw new TypeError("The elicitation schema pattern must be bounded text");
    }
    try {
      new RegExp(property.pattern);
    } catch {
      throw new TypeError("The elicitation schema pattern must be a valid regular expression");
    }
  }
  if (
    property.format !== undefined &&
    (typeof property.format !== "string" || !ALLOWED_STRING_FORMATS.has(property.format))
  ) {
    throw new TypeError("The elicitation schema string format is unsupported");
  }
  if (property.default !== undefined && !isBoundedSchemaText(property.default)) {
    throw new TypeError("The elicitation schema string default must be bounded text");
  }
  if (typeof property.default === "string") {
    const defaultLength = [...property.default].length;
    if (
      (typeof property.minLength === "number" && defaultLength < property.minLength) ||
      (typeof property.maxLength === "number" && defaultLength > property.maxLength)
    ) {
      throw new TypeError(
        "The elicitation schema string default must satisfy its length constraints",
      );
    }
  }
  const choices = validateStringChoices(property);
  if (property.enumNames !== undefined) {
    if (
      !hasEnum || !Array.isArray(property.enumNames) ||
      property.enumNames.length !== (property.enum as unknown[]).length ||
      !property.enumNames.every(isBoundedSchemaText)
    ) {
      throw new TypeError(
        "The elicitation schema enumNames must contain one bounded title per enum value",
      );
    }
  }
  if (
    choices && property.default !== undefined &&
    !choices.has(property.default as string)
  ) {
    throw new TypeError("The elicitation schema default must match an enum option");
  }
}

function validateNumberProperty(property: Record<string, unknown>): void {
  assertOnlyKeys(
    property,
    new Set(["type", "title", "description", "minimum", "maximum", "default"]),
    "numeric property",
  );
  for (const key of ["minimum", "maximum", "default"] as const) {
    if (property[key] !== undefined && !Number.isFinite(property[key])) {
      throw new TypeError(`The elicitation schema ${key} must be a finite number`);
    }
  }
  if (
    property.type === "integer" && property.default !== undefined &&
    !Number.isSafeInteger(property.default)
  ) {
    throw new TypeError("The elicitation schema integer default must be an integer");
  }
  if (
    typeof property.minimum === "number" && typeof property.maximum === "number" &&
    property.minimum > property.maximum
  ) {
    throw new TypeError("The elicitation schema minimum must not exceed maximum");
  }
  if (
    typeof property.default === "number" &&
    ((typeof property.minimum === "number" && property.default < property.minimum) ||
      (typeof property.maximum === "number" && property.default > property.maximum))
  ) {
    throw new TypeError(
      "The elicitation schema numeric default must satisfy its range constraints",
    );
  }
}

function validateArrayProperty(property: Record<string, unknown>): void {
  assertOnlyKeys(
    property,
    new Set([
      "type",
      "title",
      "description",
      "minItems",
      "maxItems",
      "items",
      "default",
    ]),
    "array property",
  );
  for (const key of ["minItems", "maxItems"] as const) {
    if (
      property[key] !== undefined &&
      (!Number.isSafeInteger(property[key]) || Number(property[key]) < 0)
    ) {
      throw new TypeError(`The elicitation schema ${key} must be a non-negative integer`);
    }
  }
  if (
    typeof property.minItems === "number" && typeof property.maxItems === "number" &&
    property.minItems > property.maxItems
  ) {
    throw new TypeError("The elicitation schema minItems must not exceed maxItems");
  }
  if (!isRecord(property.items)) {
    throw new TypeError("The elicitation schema multi-select array requires items");
  }
  const hasEnum = property.items.enum !== undefined;
  const hasAnyOf = property.items.anyOf !== undefined;
  assertOnlyKeys(
    property.items,
    hasEnum ? new Set(["type", "enum"]) : new Set(["anyOf"]),
    "array items",
  );
  if (hasEnum && property.items.type !== "string") {
    throw new TypeError("The elicitation schema array enum items must declare string type");
  }
  if (!hasEnum && !hasAnyOf) {
    throw new TypeError("The elicitation schema array items must define enum choices");
  }
  const choices = validateStringChoices({
    enum: property.items.enum,
    oneOf: property.items.anyOf,
  });
  if (!choices) {
    throw new TypeError("The elicitation schema array items must define enum choices");
  }
  if (
    typeof property.minItems === "number" &&
    property.minItems > choices.size
  ) {
    throw new TypeError(
      "The elicitation schema minItems must not exceed the number of available choices",
    );
  }
  if (property.default !== undefined) {
    if (
      !Array.isArray(property.default) ||
      !property.default.every((value) => isBoundedSchemaText(value) && choices.has(value)) ||
      new Set(property.default).size !== property.default.length
    ) {
      throw new TypeError(
        "The elicitation schema array default must contain unique enum choices",
      );
    }
    if (
      (typeof property.minItems === "number" &&
        property.default.length < property.minItems) ||
      (typeof property.maxItems === "number" &&
        property.default.length > property.maxItems)
    ) {
      throw new TypeError(
        "The elicitation schema array default must satisfy its item-count constraints",
      );
    }
  }
}

function validateProperty(property: Record<string, unknown>): void {
  validateCommonPropertyFields(property);
  switch (property.type) {
    case "string":
      validateStringProperty(property);
      break;
    case "number":
    case "integer":
      validateNumberProperty(property);
      break;
    case "boolean":
      assertOnlyKeys(
        property,
        new Set(["type", "title", "description", "default"]),
        "boolean property",
      );
      if (property.default !== undefined && typeof property.default !== "boolean") {
        throw new TypeError("The elicitation schema boolean default must be boolean");
      }
      break;
    case "array":
      validateArrayProperty(property);
      break;
    default:
      throw new TypeError(
        "The elicitation schema supports only string, number, integer, boolean, and enum array properties",
      );
  }
}

function cloneAndValidateSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(schema) || schema.type !== "object") {
    throw new TypeError("The elicitation schema must be an object schema");
  }
  assertOnlyKeys(schema, new Set(["$schema", "type", "properties", "required"]), "root");
  if (
    schema.$schema !== undefined &&
    (!isBoundedSchemaText(schema.$schema) || schema.$schema.length === 0)
  ) {
    throw new TypeError("The elicitation schema $schema dialect must be bounded text");
  }
  if (!isRecord(schema.properties)) {
    throw new TypeError("The elicitation schema must define properties");
  }
  const properties = schema.properties;
  if (Object.keys(properties).length > MAX_SCHEMA_PROPERTIES) {
    throw new TypeError(
      `The elicitation schema must not exceed ${MAX_SCHEMA_PROPERTIES} properties`,
    );
  }

  for (const [name, property] of Object.entries(properties)) {
    if (!isBoundedSchemaText(name) || name.length === 0 || !isRecord(property)) {
      throw new TypeError("The elicitation schema contains an invalid property");
    }
    validateProperty(property);
  }

  if (schema.required !== undefined) {
    if (
      !Array.isArray(schema.required) || schema.required.length > MAX_SCHEMA_PROPERTIES ||
      !schema.required.every((name) =>
        typeof name === "string" && Object.hasOwn(properties, name)
      ) ||
      new Set(schema.required).size !== schema.required.length
    ) {
      throw new TypeError(
        "The elicitation schema required list must uniquely reference defined properties",
      );
    }
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    throw new TypeError("The elicitation schema must be JSON-serializable");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_SCHEMA_BYTES) {
    throw new TypeError(
      `The elicitation schema must not exceed ${MAX_SCHEMA_BYTES} bytes`,
    );
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

/** Build a form-mode elicitation request with a restricted flat schema. */
export function buildFormElicitation(
  options: FormElicitationOptions,
): ElicitationRequest {
  if (!isRecord(options)) {
    throw new TypeError("The form elicitation options must be an object");
  }
  validateMessage(options.message);
  return {
    method: "elicitation/create",
    params: {
      mode: "form",
      message: options.message,
      requestedSchema: cloneAndValidateSchema(options.schema),
    },
  };
}

/** Build a URL-mode elicitation request without embedded credentials. */
export function buildUrlElicitation(
  options: UrlElicitationOptions,
): ElicitationRequest {
  if (!isRecord(options)) {
    throw new TypeError("The URL elicitation options must be an object");
  }
  validateMessage(options.message);
  validateElicitationUrl(options.url);
  validateElicitationId(options.elicitationId);
  return {
    method: "elicitation/create",
    params: {
      mode: "url",
      message: options.message,
      url: options.url,
      elicitationId: options.elicitationId,
    },
  };
}
