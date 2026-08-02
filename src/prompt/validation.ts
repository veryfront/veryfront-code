import type { Prompt, PromptConfig, PromptMCPConfig } from "./types.ts";

const ArrayIsArray = Array.isArray;
const ObjectFreeze = Object.freeze;
const ObjectIsFrozen = Object.isFrozen;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !ArrayIsArray(value);
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
}

/** Assert MCP prompt metadata without requiring a schema extension at runtime. */
export function assertPromptMCPConfig(
  value: unknown,
): asserts value is PromptMCPConfig {
  if (!isObjectRecord(value)) {
    throw new TypeError("Prompt MCP configuration must be an object");
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new TypeError("Prompt MCP enabled must be a boolean");
  }
  assertOptionalString(value.title, "Prompt MCP title");

  if (value.arguments === undefined) return;
  if (!ArrayIsArray(value.arguments)) {
    throw new TypeError("Prompt MCP arguments must be an array");
  }

  const names = new Set<string>();
  for (const argument of value.arguments) {
    if (!isObjectRecord(argument)) {
      throw new TypeError("Prompt MCP argument must be an object");
    }
    if (typeof argument.name !== "string" || argument.name.length === 0) {
      throw new TypeError("Prompt MCP argument name must be a non-empty string");
    }
    assertOptionalString(argument.title, "Prompt MCP argument title");
    assertOptionalString(argument.description, "Prompt MCP argument description");
    if (argument.required !== undefined && typeof argument.required !== "boolean") {
      throw new TypeError("Prompt MCP argument required must be a boolean");
    }
    if (names.has(argument.name)) {
      throw new TypeError("Prompt argument names must be unique");
    }
    names.add(argument.name);
  }
}

/** Snapshot metadata so later caller mutation cannot change the MCP contract. */
export function snapshotPromptMCPConfig(
  config: PromptMCPConfig | undefined,
): PromptMCPConfig | undefined {
  if (config === undefined) return undefined;
  assertPromptMCPConfig(config);

  if (
    ObjectIsFrozen(config) &&
    (config.arguments === undefined ||
      (ObjectIsFrozen(config.arguments) &&
        config.arguments.every((argument) => ObjectIsFrozen(argument))))
  ) {
    return config;
  }

  const arguments_ = config.arguments?.map((argument) =>
    ObjectFreeze({
      name: argument.name,
      title: argument.title,
      description: argument.description,
      required: argument.required,
    })
  );
  if (arguments_) ObjectFreeze(arguments_);

  return ObjectFreeze({
    enabled: config.enabled,
    title: config.title,
    arguments: arguments_,
  });
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
