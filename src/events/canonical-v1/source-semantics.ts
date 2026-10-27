const CONTROL_DOCUMENT = "urn:veryfront:events:1:control-payloads";
const CONTEXT_BYTES = "JSON.stringify(data) UTF-8 bytes <= 16384.";
type Schema = Record<string, unknown>;
type MatchSchema = (value: unknown, schema: Schema, documentId: string) => Promise<boolean>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type MatchRequest = { value: unknown; schema: Schema; documentId: string };
type Check = Generator<MatchRequest, boolean, boolean>;

function hasContextByteLimit(node: Schema): boolean {
  const constraints = node["x-runtime-constraints"];
  return Array.isArray(constraints) && constraints.includes(CONTEXT_BYTES);
}

function hasSourceAnnotations(node: Schema, id: string): boolean {
  return id === CONTROL_DOCUMENT && (
    typeof node.maxLength === "number" || node["x-source-transform"] === "trim" ||
    hasContextByteLimit(node)
  );
}

function acceptsSourceAnnotations(input: unknown, node: Schema, id: string): boolean {
  if (id !== CONTROL_DOCUMENT) return true;
  if (typeof input === "string") {
    if (typeof node.maxLength === "number" && input.length > node.maxLength) return false;
    if (node["x-source-transform"] === "trim" && input !== input.trim()) return false;
  }
  if (!hasContextByteLimit(node) || !isRecord(input)) return true;
  const serialized = JSON.stringify(input.data);
  return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= 16384;
}

function* inlineChildSchemas(node: Schema): Generator<Schema> {
  if (isRecord(node.properties)) {
    for (const child of Object.values(node.properties)) {
      if (isRecord(child)) yield child;
    }
  }
  if (isRecord(node.items)) yield node.items;
  for (const keyword of ["allOf", "oneOf", "anyOf"]) {
    const branches = node[keyword];
    if (!Array.isArray(branches)) continue;
    for (const child of branches) {
      if (isRecord(child)) yield child;
    }
  }
}

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
    let found = hasSourceAnnotations(node, id);
    const children: { schema: Schema; documentId: string }[] = [];
    if (typeof node.$ref === "string") children.push(resolve(node.$ref, id));
    for (const child of inlineChildSchemas(node)) {
      children.push({ schema: child, documentId: id });
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
    if (!acceptsSourceAnnotations(input, node, id)) return false;
    if (typeof node.$ref === "string") {
      const target = resolve(node.$ref, id);
      if (!(yield* check(input, target.schema, target.documentId))) return false;
    }
    if (!(yield* checkProperties(input, node, id))) return false;
    if (!(yield* checkItems(input, node, id))) return false;
    if (!(yield* checkAllOf(input, node, id))) return false;
    for (const keyword of ["oneOf", "anyOf"]) {
      if (!(yield* checkUnion(input, node[keyword], id))) return false;
    }
    return true;
  }
  function* checkProperties(input: unknown, node: Schema, id: string): Check {
    if (!isRecord(node.properties) || !isRecord(input)) return true;
    for (const [key, child] of Object.entries(node.properties)) {
      if (
        Object.hasOwn(input, key) && isRecord(child) && !(yield* check(input[key], child, id))
      ) return false;
    }
    return true;
  }
  function* checkItems(input: unknown, node: Schema, id: string): Check {
    if (!isRecord(node.items) || !Array.isArray(input)) return true;
    for (const item of input) {
      if (!(yield* check(item, node.items, id))) return false;
    }
    return true;
  }
  function* checkAllOf(input: unknown, node: Schema, id: string): Check {
    if (!Array.isArray(node.allOf)) return true;
    for (const branch of node.allOf) {
      if (isRecord(branch) && !(yield* check(input, branch, id))) return false;
    }
    return true;
  }
  function* checkUnion(input: unknown, branches: unknown, id: string): Check {
    if (!Array.isArray(branches)) return true;
    for (const branch of branches) {
      if (
        isRecord(branch) && (yield { value: input, schema: branch, documentId: id }) &&
        (yield* check(input, branch, id))
      ) return true;
    }
    return false;
  }
  return yield* check(value, schema, documentId);
}
