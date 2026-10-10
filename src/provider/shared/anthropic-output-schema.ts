/**
 * Anthropic `output_config` schema closing, shared by the Messages request
 * builder and durable model-call capture so both record the schema that is
 * actually dispatched.
 *
 * @module provider/shared/anthropic-output-schema
 */

const apply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const NativeSet = Set;
const objectDefineProperty = Object.defineProperty;
const objectKeys = Object.keys;
const arrayIncludes = Array.prototype.includes;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringStartsWith = String.prototype.startsWith;

/**
 * JSON Schema keywords whose value is itself a schema, a list of schemas, or a
 * map of schemas. Recursion is restricted to these so that keywords holding
 * literal values -- `default`, `const`, `enum`, `examples` -- are copied
 * through untouched instead of being rewritten when they happen to look like a
 * schema.
 */
const SCHEMA_MAP_KEYWORDS = createStringSet([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  // Draft-07 `dependencies` holds either a schema or an array of property
  // names per key. The array form contains strings, which the walk returns
  // unchanged, so both spellings can share this branch.
  "dependencies",
]);
const SCHEMA_LIST_KEYWORDS = createStringSet(["anyOf", "oneOf", "prefixItems"]);
/**
 * `allOf` branches describe one instance together, not alternatives, and
 * `additionalProperties` only ever sees the `properties` of the schema object
 * carrying it. Closing branches that each declare part of the object therefore
 * makes every one of them reject the others' properties, and the composition
 * accepts nothing at all:
 *
 *   allOf: [ { properties: { a }, additionalProperties: false },
 *            { properties: { b }, additionalProperties: false } ]
 *
 * `{ a, b }` fails the first branch on `b` and the second on `a`.
 *
 * So branches are walked for objects nested deeper inside them, but are not
 * closed themselves. An `allOf` of open objects is still rejected by Anthropic
 * -- which is the correct outcome, and a legible one, rather than a schema that
 * validates nothing the model can produce.
 */
const COMPOSITION_LIST_KEYWORDS = createStringSet(["allOf"]);
const SCHEMA_VALUE_KEYWORDS = createStringSet([
  "items",
  "additionalItems",
  "contains",
  "additionalProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
]);

type SchemaRecord = { [key: string]: unknown };

function getObjectKeys(value: SchemaRecord): string[] {
  return apply(objectKeys, Object, [value]) as string[];
}

function defineDataValue(
  target: SchemaRecord | unknown[],
  key: string | number,
  value: unknown,
): void {
  apply(objectDefineProperty, Object, [target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  }]);
}

function createStringSet(values: readonly string[]): Set<string> {
  const result: Set<string> = new NativeSet();
  for (let index = 0; index < values.length; index += 1) {
    apply(setAdd, result, [values[index]!]);
  }
  return result;
}

function hasSetValue(values: Set<string>, value: string): boolean {
  return apply(setHas, values, [value]) as boolean;
}

function addSetValue(values: Set<string>, value: string): void {
  apply(setAdd, values, [value]);
}

function includesArrayValue(values: readonly unknown[], value: unknown): boolean {
  return apply(arrayIncludes, values, [value]) as boolean;
}

function startsWithString(value: string, prefix: string): boolean {
  return apply(stringStartsWith, value, [prefix]) as boolean;
}

/**
 * Set `additionalProperties: false` on every object-typed subschema that left
 * it unset.
 *
 * Anthropic's `output_config.format` rejects an object schema without it with a
 * 400 -- "For 'object' type, 'additionalProperties' must be explicitly set to
 * false" -- unconditionally, and independently of the framework's own `strict`
 * flag. A plain `v.object({...})` with every field required therefore fails
 * even though it already satisfies the rest of strict structured output, so the
 * requirement is satisfied here rather than pushed onto every caller.
 *
 * An explicitly declared `additionalProperties` is preserved: rewriting it
 * would silently narrow a contract the caller deliberately opened, and
 * Anthropic surfaces its own error for that case. An explicit `undefined`
 * is not a declaration -- JSON drops it before the provider ever sees it.
 *
 * The result is a copy. The schema object belongs to the agent and is reused
 * across providers and calls, so closing it for Anthropic must not mutate it.
 */
function closeObjectSchemas(
  schema: unknown,
  closeSelf = true,
  pointer = "#",
  openTargets: Set<string> = EMPTY_POINTER_SET,
): unknown {
  if (ArrayIsArray(schema)) {
    const entries: unknown[] = [];
    for (let index = 0; index < schema.length; index += 1) {
      defineDataValue(
        entries,
        index,
        closeObjectSchemas(
          schema[index],
          closeSelf,
          `${pointer}/${index}`,
          openTargets,
        ),
      );
    }
    return entries;
  }
  if (typeof schema !== "object" || schema === null) return schema;

  const source = schema as SchemaRecord;
  const result: SchemaRecord = {};

  const keys = getObjectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const value = source[key];
    const keyPointer = `${pointer}/${encodePointerToken(key)}`;
    if (hasSetValue(SCHEMA_MAP_KEYWORDS, key)) {
      defineDataValue(result, key, closeSchemaMap(value, keyPointer, openTargets));
      continue;
    }
    if (hasSetValue(COMPOSITION_LIST_KEYWORDS, key)) {
      defineDataValue(result, key, closeObjectSchemas(value, false, keyPointer, openTargets));
      continue;
    }
    if (hasSetValue(SCHEMA_LIST_KEYWORDS, key) || hasSetValue(SCHEMA_VALUE_KEYWORDS, key)) {
      defineDataValue(result, key, closeObjectSchemas(value, true, keyPointer, openTargets));
      continue;
    }
    defineDataValue(result, key, value);
  }

  // `undefined` counts as unset, not as a declaration. The key survives the
  // walk when a caller writes it explicitly as `undefined`, but JSON drops it
  // on the way to the provider -- so honoring its presence would emit exactly
  // the open schema Anthropic rejects.
  //
  // A `$ref` holder is skipped: `additionalProperties` only ever sees the
  // `properties` of the schema object carrying it, and a `$ref` declares none
  // of its own, so closing it rejects every property the target defines.
  if (
    closeSelf && isObjectTyped(source.type) &&
    source.additionalProperties === undefined &&
    source.$ref === undefined
  ) {
    defineDataValue(result, "additionalProperties", false);
  }
  return result;
}

/**
 * Walk a keyword whose value maps names to subschemas.
 *
 * A definition reached by a `$ref` that sits directly under `allOf` stays open,
 * for the reason spelled out on `COMPOSITION_LIST_KEYWORDS`: the branches of an
 * `allOf` describe one instance together, so closing each of them makes every
 * branch reject the properties the others declare.
 */
function closeSchemaMap(
  value: unknown,
  pointer: string,
  openTargets: Set<string>,
): unknown {
  if (typeof value !== "object" || value === null || ArrayIsArray(value)) return value;
  const source = value as SchemaRecord;
  const result: SchemaRecord = {};
  const keys = getObjectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index]!;
    const namePointer = `${pointer}/${encodePointerToken(name)}`;
    defineDataValue(
      result,
      name,
      closeObjectSchemas(
        source[name],
        !hasSetValue(openTargets, namePointer),
        namePointer,
        openTargets,
      ),
    );
  }
  return result;
}

/** Shared empty set, so the common walk allocates nothing extra. */
const EMPTY_POINTER_SET: Set<string> = new NativeSet();

/** Escape a JSON pointer token, per RFC 6901. */
function encodePointerToken(token: string): string {
  let escaped = "";
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]!;
    if (char === "~") escaped += "~0";
    else if (char === "/") escaped += "~1";
    else escaped += char;
  }
  return escaped;
}

/**
 * Close every object in a schema bound for `output_config`.
 *
 * Runs a pre-pass first, because a `$ref` used as an `allOf` branch carries the
 * composition's meaning at its target rather than at the branch itself. The
 * branch object is left open by the walk, but its target lives under `$defs` or
 * `definitions`, which the walk would otherwise close. Collecting those
 * pointers up front lets the walk leave exactly those definitions open.
 *
 * A definition referenced from an `allOf` branch and used somewhere else too
 * stays open in both places. Opening is the safe direction: Anthropic rejects
 * an open object with a named 400, whereas an over-closed `allOf` is accepted
 * and then matches nothing, which surfaces as an empty generation.
 */
export function closeSchemaForOutputConfig(schema: unknown): unknown {
  const openTargets: Set<string> = new NativeSet();
  collectAllOfRefTargets(schema, openTargets);
  return closeObjectSchemas(schema, true, "#", openTargets);
}

/**
 * Collect the pointers named by `$ref` branches sitting directly under an
 * `allOf`, anywhere in the schema. Only local pointers are collected, since a
 * remote `$ref` names nothing this walk can open.
 */
function collectAllOfRefTargets(schema: unknown, out: Set<string>): void {
  if (ArrayIsArray(schema)) {
    for (let index = 0; index < schema.length; index += 1) {
      collectAllOfRefTargets(schema[index], out);
    }
    return;
  }
  if (typeof schema !== "object" || schema === null) return;

  const source = schema as SchemaRecord;
  const keys = getObjectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const value = source[key];
    if (hasSetValue(COMPOSITION_LIST_KEYWORDS, key)) {
      const branches = ArrayIsArray(value) ? value : [value];
      for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
        const branch = branches[branchIndex];
        if (typeof branch !== "object" || branch === null) continue;
        const ref = (branch as SchemaRecord).$ref;
        if (typeof ref === "string" && startsWithString(ref, "#/")) addSetValue(out, ref);
      }
    }
    collectAllOfRefTargets(value, out);
  }
}

/**
 * Whether a schema declares the object type.
 *
 * `JsonSchema.type` accepts an array as well as a single name, and the array
 * form is how a nullable object is written by hand:
 * `{ type: ["object", "null"], properties: {...} }`. Matching only the exact
 * string would leave that branch open and let Anthropic reject it.
 */
function isObjectTyped(type: unknown): boolean {
  return type === "object" || (ArrayIsArray(type) && includesArrayValue(type, "object"));
}
