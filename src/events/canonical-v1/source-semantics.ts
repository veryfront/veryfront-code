const CONTROL_DOCUMENT = "urn:veryfront:events:1:control-payloads";
const CONTEXT_BYTES = "JSON.stringify(data) UTF-8 bytes <= 16384.";
type Schema = Record<string, unknown>;
type MatchSchema = (value: unknown, schema: Schema, documentId: string) => Promise<boolean>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type MatchRequest = { value: unknown; schema: Schema; documentId: string };
type Check = Generator<MatchRequest, boolean, boolean>;

/** Check source annotations after structural validation, without changing payload data. */
export async function validateSourceSemantics(
  value: unknown,
  schema: Schema,
  documentId: string,
  documents: Record<string, Schema>,
  matchesSchema: MatchSchema,
): Promise<void> {
  const checks = sourceChecks(value, schema, documentId, documents);
  let result = checks.next();
  while (!result.done) {
    const request = result.value;
    result = checks.next(await matchesSchema(request.value, request.schema, request.documentId));
  }
  assertAccepted(result.value);
}

/** Synchronous counterpart for synchronous structural schema compilers. */
export function validateSourceSemanticsSync(
  value: unknown,
  schema: Schema,
  documentId: string,
  documents: Record<string, Schema>,
  matchesSchema: (value: unknown, schema: Schema, documentId: string) => boolean,
): void {
  const checks = sourceChecks(value, schema, documentId, documents);
  let result = checks.next();
  while (!result.done) {
    const request = result.value;
    result = checks.next(matchesSchema(request.value, request.schema, request.documentId));
  }
  assertAccepted(result.value);
}
function assertAccepted(accepted: boolean): void {
  if (!accepted) throw new TypeError("Invalid canonical-v1 source semantics");
}
function* sourceChecks(
  value: unknown,
  schema: Schema,
  documentId: string,
  documents: Record<string, Schema>,
): Check {
  function resolve(reference: string, currentId: string): { schema: Schema; documentId: string } {
    const [id, fragment = ""] = reference.split("#");
    const resolvedId = id || currentId;
    let target: unknown = documents[resolvedId];
    if (fragment && !fragment.startsWith("/")) {
      throw new TypeError("Invalid source schema reference");
    }
    for (const token of fragment === "" ? [] : fragment.slice(1).split("/")) {
      target = isRecord(target)
        ? target[token.replaceAll("~1", "/").replaceAll("~0", "~")]
        : undefined;
    }
    if (!isRecord(target)) throw new TypeError("Unknown source schema reference");
    return { schema: target, documentId: resolvedId };
  }
  // Cache only complete searches: recursive opaque JSON definitions contain no annotations.
  const relevant = new Map<Schema, boolean>();
  function hasChecks(node: Schema, id: string, visiting = new Set<Schema>()): boolean {
    const cached = relevant.get(node);
    if (cached !== undefined) return cached;
    if (visiting.has(node)) return false;
    visiting.add(node);
    let found = id === CONTROL_DOCUMENT && (
      typeof node.maxLength === "number" || node["x-source-transform"] === "trim" ||
      (Array.isArray(node["x-runtime-constraints"]) &&
        node["x-runtime-constraints"].includes(CONTEXT_BYTES))
    );
    const children: { schema: Schema; documentId: string }[] = [];
    if (typeof node.$ref === "string") children.push(resolve(node.$ref, id));
    if (isRecord(node.properties)) {
      for (const child of Object.values(node.properties)) {
        if (isRecord(child)) children.push({ schema: child, documentId: id });
      }
    }
    if (isRecord(node.items)) children.push({ schema: node.items, documentId: id });
    for (const keyword of ["allOf", "oneOf", "anyOf"]) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        for (const child of branches) {
          if (isRecord(child)) children.push({ schema: child, documentId: id });
        }
      }
    }
    for (const child of children) {
      found = hasChecks(child.schema, child.documentId, visiting) || found;
    }
    visiting.delete(node);
    // A cycle may reach checks through another ancestor; do not memoize partial negatives.
    if (found || visiting.size === 0) relevant.set(node, found);
    return found;
  }
  const active = new Map<Schema, Set<unknown>>();
  function* check(input: unknown, node: Schema, id: string): Check {
    if (!hasChecks(node, id)) return true;
    let inputs = active.get(node);
    if (!inputs) {
      inputs = new Set();
      active.set(node, inputs);
    }
    if (inputs.has(input)) return true;
    inputs.add(input);
    try {
      return yield* checkNode(input, node, id);
    } finally {
      inputs.delete(input);
    }
  }
  function* checkNode(input: unknown, node: Schema, id: string): Check {
    if (id === CONTROL_DOCUMENT) {
      if (typeof input === "string") {
        if (typeof node.maxLength === "number" && input.length > node.maxLength) return false;
        if (node["x-source-transform"] === "trim" && input !== input.trim()) return false;
      }
      if (
        Array.isArray(node["x-runtime-constraints"]) &&
        node["x-runtime-constraints"].includes(CONTEXT_BYTES) && isRecord(input)
      ) {
        const serialized = JSON.stringify(input.data);
        if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 16384) {
          return false;
        }
      }
    }
    if (typeof node.$ref === "string") {
      const target = resolve(node.$ref, id);
      if (!(yield* check(input, target.schema, target.documentId))) return false;
    }
    if (isRecord(node.properties) && isRecord(input)) {
      for (const [key, child] of Object.entries(node.properties)) {
        if (
          Object.hasOwn(input, key) && isRecord(child) && !(yield* check(input[key], child, id))
        ) {
          return false;
        }
      }
    }
    if (isRecord(node.items) && Array.isArray(input)) {
      for (const item of input) if (!(yield* check(item, node.items, id))) return false;
    }
    if (Array.isArray(node.allOf)) {
      for (const branch of node.allOf) {
        if (isRecord(branch) && !(yield* check(input, branch, id))) return false;
      }
    }
    for (const keyword of ["oneOf", "anyOf"]) {
      const branches = node[keyword];
      if (!Array.isArray(branches)) continue;
      let accepted = false;
      for (const branch of branches) {
        if (
          isRecord(branch) && (yield { value: input, schema: branch, documentId: id }) &&
          (yield* check(input, branch, id))
        ) {
          accepted = true;
          break;
        }
      }
      if (!accepted) return false;
    }
    return true;
  }
  return yield* check(value, schema, documentId);
}
