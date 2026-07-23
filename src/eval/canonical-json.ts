const MAX_CANONICAL_JSON_DEPTH = 100;
const MAX_CANONICAL_JSON_NODES = 1_000_000;

type CanonicalState = {
  nodes: number;
  seen: WeakSet<object>;
};

function canonicalize(value: unknown, state: CanonicalState, depth: number): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_JSON_NODES) {
    throw new TypeError(`JSON value exceeds the ${MAX_CANONICAL_JSON_NODES}-node limit`);
  }
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_CANONICAL_JSON_DEPTH) {
    throw new TypeError(`JSON value exceeds the maximum depth of ${MAX_CANONICAL_JSON_DEPTH}`);
  }
  if (state.seen.has(value)) {
    throw new TypeError("JSON value must not contain circular references");
  }
  state.seen.add(value);

  try {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      return canonicalize(toJSON.call(value), state, depth + 1);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalize(entry, state, depth + 1));
    }

    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key], state, depth + 1);
    }
    return sorted;
  } finally {
    state.seen.delete(value);
  }
}

/** Stringify a JSON-compatible value with deterministic object-key ordering. */
export function canonicalJsonStringify(value: unknown): string | undefined {
  return JSON.stringify(canonicalize(value, { nodes: 0, seen: new WeakSet() }, 0));
}
