import { parse } from "acorn";
import { name as isIdentifierName } from "estree-util-is-identifier-name";
import type { Pluggable } from "unified";
import type { ContentModuleValues } from "veryfront/extensions/content";

interface ProgramNode {
  type: "Program";
  body: Array<{ type: string; [key: string]: unknown }>;
}

const MODULE_VALUE_OPTION_NAMES = new Set<PropertyKey>(["bindings", "exports"]);

function assertPlainObject(value: object, path: string): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`);
  }
}

function validateModuleValueOptions(values: ContentModuleValues): void {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new TypeError("MDX module values must be a plain object");
  }
  assertPlainObject(values, "MDX module values");

  const descriptors = Object.getOwnPropertyDescriptors(values);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError("MDX module values contain an enumerable symbol option");
    }
    if (!MODULE_VALUE_OPTION_NAMES.has(key)) {
      throw new TypeError(`MDX module values contain unknown option ${JSON.stringify(key)}`);
    }
  }
}

function getDataEntries(
  values: Readonly<Record<string, unknown>> | undefined,
  path: string,
): Array<[string, unknown]> {
  if (values === undefined) return [];
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new TypeError(`${path} must be a plain object`);
  }
  assertPlainObject(values, path);

  const entries: Array<[string, unknown]> = [];
  const descriptors = Object.getOwnPropertyDescriptors(values);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError(`${path} contains an enumerable symbol key`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`${path}.${key} must be a data property`);
    }
    entries.push([key, descriptor.value]);
  }

  return entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function readModuleValueRecord(
  values: ContentModuleValues,
  key: keyof ContentModuleValues,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new TypeError("MDX module values must be a plain object");
  }
  assertPlainObject(values, "MDX module values");

  const descriptor = Object.getOwnPropertyDescriptor(values, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`MDX module values.${key} must be a data property`);
  }
  if (descriptor.value === undefined) return undefined;
  if (
    typeof descriptor.value !== "object" ||
    descriptor.value === null ||
    Array.isArray(descriptor.value)
  ) {
    throw new TypeError(`MDX module values.${key} must be a plain object`);
  }
  return descriptor.value as Readonly<Record<string, unknown>>;
}

function cloneJsonValue(value: unknown, path: string, active: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers`);
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${path} is not JSON-serializable`);
  }
  if (active.has(value)) {
    throw new TypeError(`${path} contains a cycle`);
  }

  if (value instanceof Date) {
    try {
      return Date.prototype.toISOString.call(value);
    } catch (error) {
      throw new TypeError(`${path} contains an invalid date`, { cause: error });
    }
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const clone: unknown[] = [];
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        if (typeof key === "symbol" || !/^(?:0|[1-9]\d*)$/.test(key)) {
          throw new TypeError(`${path} contains an unsupported enumerable property`);
        }
      }

      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined) {
          throw new TypeError(`${path} contains a sparse array`);
        }
        if (!("value" in descriptor)) {
          throw new TypeError(`${path}[${index}] must be a data property`);
        }
        clone.push(cloneJsonValue(descriptor.value, `${path}[${index}]`, active));
      }
      return clone;
    }

    assertPlainObject(value, `${path} value`);

    const clone = Object.create(null) as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor?.enumerable) continue;
      if (typeof key !== "string") {
        throw new TypeError(`${path} contains an enumerable symbol key`);
      }
      if (!("value" in descriptor)) {
        throw new TypeError(`${path}.${key} must be a data property`);
      }
      clone[key] = cloneJsonValue(descriptor.value, `${path}.${key}`, active);
    }
    return clone;
  } finally {
    active.delete(value);
  }
}

function normalizeModuleValue(name: string, value: unknown): unknown {
  return cloneJsonValue(value, `MDX module value ${JSON.stringify(name)}`, new Set());
}

function serializeModuleValue(name: string, value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(`MDX module value ${JSON.stringify(name)} is not JSON-serializable`);
  }
  return serialized;
}

function assertIdentifierName(name: string): void {
  if (!isIdentifierName(name)) {
    throw new TypeError(`Invalid MDX module value name: ${JSON.stringify(name)}`);
  }
}

function createModuleValueDeclarations(
  bindings: Array<[string, unknown]>,
  exports: Array<[string, unknown]>,
): ProgramNode["body"] {
  for (const [name] of [...bindings, ...exports]) assertIdentifierName(name);

  const source = [
    ...bindings.map(([name, value]) => `const ${name} = ${serializeModuleValue(name, value)};`),
    ...exports.map(([name, value]) =>
      `export const ${name} = ${serializeModuleValue(name, value)};`
    ),
  ].join("\n");

  if (!source) return [];
  return (parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as ProgramNode).body;
}

export interface PreparedModuleValues {
  plugin: Pluggable;
  bindings: Record<string, unknown>;
}

export function prepareModuleValues(values: ContentModuleValues): PreparedModuleValues {
  validateModuleValueOptions(values);
  const bindings = getDataEntries(
    readModuleValueRecord(values, "bindings"),
    "MDX module values.bindings",
  )
    .map(([name, value]) => [name, normalizeModuleValue(name, value)] as [string, unknown]);
  const exports = getDataEntries(
    readModuleValueRecord(values, "exports"),
    "MDX module values.exports",
  )
    .map(([name, value]) => [name, normalizeModuleValue(name, value)] as [string, unknown]);
  const bindingNames = new Set(bindings.map(([name]) => name));
  for (const [name] of exports) {
    if (bindingNames.has(name)) {
      throw new TypeError(
        `MDX module value ${JSON.stringify(name)} cannot be both a binding and an export`,
      );
    }
  }
  const declarations = createModuleValueDeclarations(bindings, exports);

  const plugin = (() => (tree: ProgramNode) => {
    const insertionIndex = tree.body.findIndex((node) => node.type !== "ImportDeclaration");
    tree.body.splice(
      insertionIndex === -1 ? tree.body.length : insertionIndex,
      0,
      ...declarations,
    );
  }) as unknown as Pluggable;

  return {
    plugin,
    bindings: Object.fromEntries(bindings),
  };
}

export function validateModuleProgram(code: string): void {
  parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
}
