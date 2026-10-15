const encoder = new TextEncoder();
/** Check the source JSON context-item budget after structural validation. */
export function hasSourceContextBudget(payload: unknown): boolean {
  if (
    !payload || typeof payload !== "object" || !("type" in payload) ||
    payload.type !== "com.veryfront.run.requested" ||
    !("context" in payload) || !Array.isArray(payload.context)
  ) return true;
  return payload.context.every((item: unknown) => {
    if (
      !item || typeof item !== "object" || !("type" in item) || item.type !== "json" ||
      !("data" in item)
    ) return true;
    const json = JSON.stringify(item.data);
    return json !== undefined && encoder.encode(json).byteLength <= 16384;
  });
}

const refinementPresence = new WeakMap<object, boolean>();
function needsRefinements(
  schema: object,
  documentId: string,
  documents: Record<string, Record<string, unknown>>,
  seen = new Set<object>(),
): boolean {
  const cached = refinementPresence.get(schema);
  if (cached !== undefined) return cached;
  if (seen.has(schema)) return false;
  seen.add(schema);
  if ("maxLength" in schema || "minLength" in schema || "x-source-transform" in schema) return true;
  if ("$ref" in schema && typeof schema.$ref === "string") {
    const [id, fragment = ""] = schema.$ref.split("#");
    let target: unknown = documents[id || documentId];
    for (const token of fragment.split("/").slice(1)) {
      if (!target || typeof target !== "object") return false;
      target = Reflect.get(target, token.replaceAll("~1", "/").replaceAll("~0", "~"));
    }
    if (
      target && typeof target === "object" &&
      needsRefinements(target, id || documentId, documents, seen)
    ) return true;
  }
  for (const child of Object.values(schema)) {
    if (
      child && typeof child === "object" && needsRefinements(child, documentId, documents, seen)
    ) return true;
  }
  return false;
}
/** Supplement producer string refinements that JSON Schema does not express. */
export async function hasSourceConstraints(
  value: unknown,
  schema: unknown,
  documentId: string,
  documents: Record<string, Record<string, unknown>>,
  accepts: (
    value: unknown,
    schema: Record<string, unknown>,
    documentId: string,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return true;
  let needed = refinementPresence.get(schema);
  if (needed === undefined) {
    needed = needsRefinements(schema, documentId, documents);
    refinementPresence.set(schema, needed);
  }
  if (!needed) return true;
  const check = (childValue: unknown, childSchema: unknown, id = documentId) =>
    hasSourceConstraints(childValue, childSchema, id, documents, accepts);
  if ("$ref" in schema && typeof schema.$ref === "string") {
    const [id, fragment = ""] = schema.$ref.split("#");
    const resolvedId = id || documentId;
    let target: unknown = documents[resolvedId];
    for (const token of fragment.split("/").slice(1)) {
      const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!target || typeof target !== "object" || !(key in target)) return false;
      target = Reflect.get(target, key);
    }
    if (!await check(value, target, resolvedId)) return false;
  }
  if (typeof value === "string") {
    if (
      "maxLength" in schema && typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) return false;
    if (
      "minLength" in schema && typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) return false;
    if (
      "x-source-transform" in schema && schema["x-source-transform"] === "trim" &&
      value.trim() !== value
    ) return false;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches: unknown = Reflect.get(schema, keyword);
    if (!Array.isArray(branches)) continue;
    let accepted = false;
    for (const branch of branches) {
      if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue;
      if (await accepts(value, branch, documentId) && await check(value, branch)) {
        accepted = true;
        break;
      }
    }
    if (!accepted) return false;
  }
  if ("allOf" in schema && Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) if (!await check(value, branch)) return false;
  }
  if (Array.isArray(value) && "items" in schema) {
    for (const item of value) if (!await check(item, schema.items)) return false;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties: unknown = Reflect.get(schema, "properties");
    for (const [key, entry] of Object.entries(value)) {
      if (properties && typeof properties === "object" && Object.hasOwn(properties, key)) {
        if (!await check(entry, Reflect.get(properties, key))) return false;
      } else if (
        "additionalProperties" in schema && !await check(entry, schema.additionalProperties)
      ) {
        return false;
      }
    }
  }
  return true;
}
