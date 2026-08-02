import type { Prompt, PromptConfig, PromptMCPConfig } from "./types.ts";

const ArrayIsArray = Array.isArray;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

interface OwnDataProperty {
  readonly present: boolean;
  readonly value: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  try {
    return !ArrayIsArray(value);
  } catch {
    return false;
  }
}

function readOwnDataProperty(
  object: object,
  property: PropertyKey,
  field: string,
): OwnDataProperty {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(object, property);
  } catch {
    throw new TypeError(`${field} must be an own data property`);
  }
  if (descriptor === undefined) return { present: false, value: undefined };
  if (!("value" in descriptor)) {
    throw new TypeError(`${field} must be an own data property`);
  }
  return { present: true, value: descriptor.value };
}

function assertOptionalStringProperty(property: OwnDataProperty, field: string): void {
  const value = property.value;
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
}

type PromptMCPArgument = NonNullable<PromptMCPConfig["arguments"]>[number];

function parsePromptMCPArgument(value: unknown): PromptMCPArgument {
  if (!isObjectRecord(value)) {
    throw new TypeError("Prompt MCP argument must be an object");
  }

  const name = readOwnDataProperty(value, "name", "Prompt MCP argument name");
  const title = readOwnDataProperty(value, "title", "Prompt MCP argument title");
  const description = readOwnDataProperty(
    value,
    "description",
    "Prompt MCP argument description",
  );
  const required = readOwnDataProperty(value, "required", "Prompt MCP argument required");

  if (!name.present || typeof name.value !== "string" || name.value.length === 0) {
    throw new TypeError("Prompt MCP argument name must be a non-empty string");
  }
  assertOptionalStringProperty(title, "Prompt MCP argument title");
  assertOptionalStringProperty(description, "Prompt MCP argument description");
  if (required.value !== undefined && typeof required.value !== "boolean") {
    throw new TypeError("Prompt MCP argument required must be a boolean");
  }

  return ObjectFreeze({
    name: name.value,
    title: title.value as string | undefined,
    description: description.value as string | undefined,
    required: required.value as boolean | undefined,
  });
}

function parsePromptMCPConfig(value: unknown): PromptMCPConfig {
  if (!isObjectRecord(value)) {
    throw new TypeError("Prompt MCP configuration must be an object");
  }

  const enabled = readOwnDataProperty(value, "enabled", "Prompt MCP enabled");
  const title = readOwnDataProperty(value, "title", "Prompt MCP title");
  const argumentsProperty = readOwnDataProperty(value, "arguments", "Prompt MCP arguments");

  if (enabled.value !== undefined && typeof enabled.value !== "boolean") {
    throw new TypeError("Prompt MCP enabled must be a boolean");
  }
  assertOptionalStringProperty(title, "Prompt MCP title");

  let arguments_: PromptMCPConfig["arguments"];
  if (argumentsProperty.value !== undefined) {
    let isArray = false;
    try {
      isArray = ArrayIsArray(argumentsProperty.value);
    } catch {
      throw new TypeError("Prompt MCP arguments must be an array");
    }
    if (!isArray) {
      throw new TypeError("Prompt MCP arguments must be an array");
    }

    const argumentValues = argumentsProperty.value as unknown[];
    const length = readOwnDataProperty(argumentValues, "length", "Prompt MCP arguments length");
    if (typeof length.value !== "number") {
      throw new TypeError("Prompt MCP arguments length must be a number");
    }

    const names = new Set<string>();
    const parsedArguments = new Array<PromptMCPArgument>();
    for (let index = 0; index < length.value; index += 1) {
      const argument = parsePromptMCPArgument(
        readOwnDataProperty(argumentValues, index, `Prompt MCP argument ${index}`).value,
      );
      if (names.has(argument.name)) {
        throw new TypeError("Prompt argument names must be unique");
      }
      names.add(argument.name);
      parsedArguments.push(argument);
    }
    arguments_ = ObjectFreeze(parsedArguments) as PromptMCPConfig["arguments"];
  }

  return ObjectFreeze({
    enabled: enabled.value as boolean | undefined,
    title: title.value as string | undefined,
    arguments: arguments_,
  });
}

/** Assert MCP prompt metadata without requiring a schema extension at runtime. */
export function assertPromptMCPConfig(
  value: unknown,
): asserts value is PromptMCPConfig {
  parsePromptMCPConfig(value);
}

/** Snapshot metadata so later caller mutation cannot change the MCP contract. */
export function snapshotPromptMCPConfig(
  config: PromptMCPConfig | undefined,
): PromptMCPConfig | undefined {
  if (config === undefined) return undefined;
  return parsePromptMCPConfig(config);
}

/** Validate the construction boundary while remaining schema-bootstrap independent. */
export function assertPromptConfig(
  value: unknown,
): asserts value is PromptConfig {
  if (!isObjectRecord(value)) {
    throw new TypeError("Prompt configuration must be an object");
  }
  if (value.id !== undefined) {
    if (typeof value.id !== "string" || value.id.trim().length === 0) {
      throw new TypeError("Prompt id must not be empty");
    }
  }
  if (typeof value.description !== "string") {
    throw new TypeError("Prompt description must be a string");
  }
  assertOptionalString(value.suggestion, "Prompt suggestion");
  if (value.content !== undefined && typeof value.content !== "string") {
    throw new TypeError("Prompt content must be a string");
  }
  if (value.generate !== undefined && typeof value.generate !== "function") {
    throw new TypeError("Prompt generator must be a function");
  }
  if (value.content === undefined && value.generate === undefined) {
    throw new TypeError("Prompt must define static content or a generator");
  }
  if (value.mcp !== undefined) assertPromptMCPConfig(value.mcp);
}

/** Validate and snapshot a prompt before it crosses the registry boundary. */
export function normalizePromptDefinition(id: string, value: Prompt): Prompt {
  if (!isObjectRecord(value)) {
    throw new TypeError("Prompt definition must be an object");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new TypeError("Prompt definition id must be a non-empty string");
  }
  if (value.id !== id) {
    throw new TypeError(
      `Prompt registry id "${id}" does not match definition id "${value.id}"`,
    );
  }
  if (typeof value.description !== "string") {
    throw new TypeError("Prompt description must be a string");
  }
  assertOptionalString(value.suggestion, "Prompt suggestion");
  if (typeof value.getContent !== "function") {
    throw new TypeError("Prompt getContent must be a function");
  }

  const mcp = snapshotPromptMCPConfig(value.mcp);
  return mcp === value.mcp ? value : { ...value, mcp };
}
