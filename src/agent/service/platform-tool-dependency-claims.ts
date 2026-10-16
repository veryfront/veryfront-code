import { readOwnDataProperty } from "#veryfront/agent/runtime/data-property-descriptor.ts";
import { appendPrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
const ReflectApply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const ObjectFreeze = Object.freeze;
const RegExpExec = RegExp.prototype.exec;

export type VerifiedPlatformToolDependencies = readonly Readonly<{
  toolId: string;
  platformTools: readonly string[];
}>[];

export function readPlatformToolDependencies(value: unknown): VerifiedPlatformToolDependencies {
  if (!ArrayIsArray(value) || value.length > 100) throw new Error("Invalid wrapper grant");
  const wrappers = createPrivateSet<string>();
  const operations = createPrivateSet<string>();
  const result: Readonly<{ toolId: string; platformTools: readonly string[] }>[] = [];
  let edges = 0;
  for (let index = 0; index < value.length; index++) {
    const entry = readOwnDataProperty(value, index, "Wrapper grants");
    const toolId = readOwnDataProperty(entry, "toolId", "Wrapper grant");
    const names = readOwnDataProperty(entry, "platformTools", "Wrapper grant");
    if (
      typeof toolId !== "string" || !toolId || toolId.length > 128 || wrappers.has(toolId) ||
      !ArrayIsArray(names) || names.length > 100
    ) throw new Error("Invalid wrapper grant");
    wrappers.add(toolId);
    edges += names.length;
    if (edges > 100) throw new Error("Platform grant limit exceeded");
    const ownNames = createPrivateSet<string>();
    const copied: string[] = [];
    for (let nameIndex = 0; nameIndex < names.length; nameIndex++) {
      const name = readOwnDataProperty(names, nameIndex, "Platform grant");
      if (
        typeof name !== "string" || name.length > 128 ||
        ReflectApply(RegExpExec, /^[a-z][a-z0-9_]*__[a-z][a-z0-9_]*$/, [name]) === null ||
        ownNames.has(name)
      ) throw new Error("Invalid platform operation");
      ownNames.add(name);
      operations.add(name);
      appendPrivateArray(copied, [name]);
    }
    appendPrivateArray(result, [ObjectFreeze({ toolId, platformTools: ObjectFreeze(copied) })]);
  }
  if (operations.size > 100) throw new Error("Platform grant limit exceeded");
  return ObjectFreeze(result);
}
