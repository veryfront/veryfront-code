/**
 * ext-sandbox-shell-tools, SandboxShellToolsProvider backed by bash-tool.
 *
 * @module extensions/ext-sandbox-shell-tools
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type CreateSandboxShellToolsInput,
  type SandboxShellToolsProvider,
  SandboxShellToolsProviderName,
} from "veryfront/extensions/sandbox";
import { zodToJsonSchema } from "zod-to-json-schema";

type BashToolFactory = (
  input: CreateSandboxShellToolsInput,
) => Promise<{ tools: Record<string, unknown> }>;

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Sandbox shell tool ${key} must be a data property`);
  }
  return descriptor.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneToolDefinition(
  definition: Record<string, unknown>,
  toolName: string,
): Record<string, unknown> {
  const clone: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(definition)) {
    const descriptor = Object.getOwnPropertyDescriptor(definition, key);
    if (!descriptor) continue;
    if (typeof key !== "string") {
      if (descriptor.enumerable) {
        throw new TypeError(`Sandbox shell tool ${toolName} must not have symbol properties`);
      }
      continue;
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`Sandbox shell tool ${toolName} property ${key} must be a data property`);
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return clone;
}

function convertInputSchema(inputSchema: unknown, toolName: string): unknown {
  if (!isRecord(inputSchema)) {
    throw new TypeError(`Sandbox shell tool ${toolName} input schema must be an object`);
  }

  const standard = ownDataValue(inputSchema, "~standard");
  if (!isRecord(standard)) {
    throw new TypeError(
      `Sandbox shell tool ${toolName} input schema does not implement Standard Schema`,
    );
  }
  const vendor = ownDataValue(standard, "vendor");
  if (vendor === "zod") {
    return zodToJsonSchema(inputSchema as never, { target: "openAi" });
  }

  const jsonSchema = ownDataValue(standard, "jsonSchema");
  if (isRecord(jsonSchema)) {
    const input = ownDataValue(jsonSchema, "input");
    if (typeof input === "function") {
      return input({ target: "draft-07" });
    }
  }
  throw new TypeError(
    `Sandbox shell tool ${toolName} Standard Schema vendor ${
      typeof vendor === "string" ? vendor : typeof vendor
    } cannot produce JSON Schema`,
  );
}

async function attachJsonSchemas(
  result: { tools: Record<string, unknown> },
): Promise<{ tools: Record<string, unknown> }> {
  const sourceTools = ownDataValue(result, "tools");
  if (!isRecord(sourceTools)) {
    throw new TypeError("Sandbox shell tools provider must return a tools object");
  }

  const tools: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(sourceTools)) {
    const descriptor = Object.getOwnPropertyDescriptor(sourceTools, key);
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError("Sandbox shell tool names must be strings");
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`Sandbox shell tool ${key} must be a data property`);
    }

    if (!isRecord(descriptor.value)) {
      Object.defineProperty(tools, key, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
      continue;
    }

    const definition = cloneToolDefinition(descriptor.value, key);
    const existingJsonSchema = ownDataValue(definition, "inputSchemaJson");
    const inputSchema = ownDataValue(definition, "inputSchema");
    if (existingJsonSchema !== undefined || inputSchema === undefined) {
      Object.defineProperty(tools, key, {
        configurable: true,
        enumerable: true,
        value: definition,
        writable: true,
      });
      continue;
    }

    let inputSchemaJson: unknown;
    try {
      inputSchemaJson = await convertInputSchema(inputSchema, key);
    } catch (cause) {
      throw new TypeError(`Unable to convert sandbox shell tool ${key} input schema`, {
        cause,
      });
    }

    Object.defineProperty(definition, "inputSchemaJson", {
      configurable: true,
      enumerable: true,
      value: inputSchemaJson,
      writable: true,
    });
    Object.defineProperty(tools, key, {
      configurable: true,
      enumerable: true,
      value: definition,
      writable: true,
    });
  }

  return { tools };
}

export function createSandboxShellToolsProvider(
  createBashToolImpl: BashToolFactory,
): SandboxShellToolsProvider {
  return async (input) => await attachJsonSchemas(await createBashToolImpl(input));
}

const provider = createSandboxShellToolsProvider(async (input) => {
  const { createBashTool: createBashToolImpl } = await import("bash-tool");
  return await createBashToolImpl(input);
});

const extSandboxShellTools: ExtensionFactory = () => ({
  name: "ext-sandbox-shell-tools",
  version: "0.1.0",
  contracts: {
    provides: [SandboxShellToolsProviderName],
  },
  capabilities: [
    { type: "sandbox:execute", tools: ["bash"] },
  ],
  setup(ctx) {
    ctx.provide(SandboxShellToolsProviderName, provider);
    ctx.logger.debug("[ext-sandbox-shell-tools] Sandbox shell tools provider registered");
  },
});

export default extSandboxShellTools;
export { provider as createBashSandboxShellToolsProvider };
