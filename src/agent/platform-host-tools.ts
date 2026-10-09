import type { HostToolDefinition, HostToolSet } from "#veryfront/tool";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { CANONICAL_FORM_INPUT_TOOL_ID, FORM_INPUT_TOOL_ID } from "./platform-tool-names.ts";

const reflectApply = Reflect.apply;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const stringIndexOf = String.prototype.indexOf;

function ownKeys(value: HostToolSet | HostToolDefinition): string[] {
  return reflectApply(objectKeys, Object, [value]) as string[];
}

function hasOwn(
  value: HostToolSet | HostToolDefinition | PropertyDescriptor,
  key: string,
): boolean {
  return reflectApply(objectHasOwn, Object, [value, key]) as boolean;
}

function ownDataValue(value: HostToolSet | HostToolDefinition, key: string): unknown {
  const descriptor = reflectApply(objectGetOwnPropertyDescriptor, Object, [value, key]) as
    | PropertyDescriptor
    | undefined;
  return descriptor !== undefined && hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function dataDescriptor(value: unknown): PropertyDescriptor {
  const descriptor = objectCreate(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.writable = true;
  descriptor.value = value;
  return descriptor;
}

function defineData(target: HostToolSet | HostToolDefinition, key: string, value: unknown): void {
  reflectApply(objectDefineProperty, Object, [target, key, dataDescriptor(value)]);
}

function copyOwnDataTools(target: HostToolSet, source: HostToolSet): void {
  const keys = ownKeys(source);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const value = ownDataValue(source, key);
    if (value !== undefined) defineData(target, key, value);
  }
}

function cloneHostToolDefinitionWithId(
  definition: HostToolDefinition,
  id: string,
): HostToolDefinition {
  const wrapper = objectCreate(null) as HostToolDefinition;
  const keys = ownKeys(definition);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const value = ownDataValue(definition, key);
    if (value !== undefined) defineData(wrapper, key, value);
  }
  defineData(wrapper, "id", id);
  return wrapper;
}

function hasPlatformNamespace(name: string): boolean {
  return (reflectApply(stringIndexOf, name, ["__"]) as number) !== -1;
}

/** Keep platform host tools available beside colliding project tools. */
export function withPlatformHostToolAliases(
  platformTools: HostToolSet,
  localTools: HostToolSet = {},
): HostToolSet {
  const tools = objectCreate(null) as HostToolSet;
  copyOwnDataTools(tools, platformTools);
  copyOwnDataTools(tools, localTools);

  const platformNames = ownKeys(platformTools);
  for (let index = 0; index < platformNames.length; index++) {
    const name = platformNames[index]!;
    const definition = ownDataValue(platformTools, name) as HostToolDefinition | undefined;
    if (definition === undefined) continue;

    if (name === CANONICAL_FORM_INPUT_TOOL_ID) {
      defineData(tools, CANONICAL_FORM_INPUT_TOOL_ID, markTrustedHostToolProvenance(definition));
      if (!hasOwn(localTools, FORM_INPUT_TOOL_ID)) {
        defineData(
          tools,
          FORM_INPUT_TOOL_ID,
          markTrustedHostToolProvenance(
            cloneHostToolDefinitionWithId(definition, FORM_INPUT_TOOL_ID),
          ),
        );
      }
      continue;
    }

    if (hasPlatformNamespace(name)) continue;
    if (!hasOwn(localTools, name)) {
      defineData(tools, name, markTrustedHostToolProvenance(definition));
    }
    const canonicalName = `veryfront__${name}`;
    defineData(
      tools,
      canonicalName,
      markTrustedHostToolProvenance(cloneHostToolDefinitionWithId(definition, canonicalName)),
    );
  }
  return tools;
}
