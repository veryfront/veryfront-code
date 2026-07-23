import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/** Validated JSON-serializable metadata extracted from MDX or Markdown. */
export interface MDXFrontmatter {
  /** Optional document title. */
  title?: string;
  /** Optional document summary. */
  description?: string;
  /** Whether the renderer applies the configured layout. */
  layout?: boolean;
  [key: string]: unknown;
}

const MAX_FRONTMATTER_DEPTH = 32;
const MAX_FRONTMATTER_NODES = 10_000;
const MAX_FRONTMATTER_TEXT_BYTES = 1024 * 1024;
const MAX_FRONTMATTER_KEY_BYTES = 4_096;
const UTF8_ENCODER = new TextEncoder();

interface FrontmatterBudget {
  nodes: number;
  textBytes: number;
  ancestors: WeakSet<object>;
}

function consumeNode(budget: FrontmatterBudget): void {
  budget.nodes++;
  if (budget.nodes > MAX_FRONTMATTER_NODES) {
    throw new TypeError("Frontmatter exceeds the node limit");
  }
}

function consumeText(value: string, budget: FrontmatterBudget, maxBytes: number): void {
  if (value.length > maxBytes) throw new TypeError("Frontmatter text exceeds the size limit");
  const bytes = UTF8_ENCODER.encode(value).byteLength;
  if (bytes > maxBytes || budget.textBytes > MAX_FRONTMATTER_TEXT_BYTES - bytes) {
    throw new TypeError("Frontmatter text exceeds the size limit");
  }
  budget.textBytes += bytes;
}

function cloneSerializableValue(
  value: unknown,
  path: string,
  depth: number,
  budget: FrontmatterBudget,
): unknown {
  if (depth > MAX_FRONTMATTER_DEPTH) {
    throw new TypeError("Frontmatter exceeds the depth limit");
  }
  consumeNode(budget);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    consumeText(value, budget, MAX_FRONTMATTER_TEXT_BYTES);
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`Frontmatter ${path} must be a finite number`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Frontmatter ${path} must be JSON-serializable`);
  }
  if (value instanceof Date) {
    if (
      Object.getPrototypeOf(value) === Date.prototype && Reflect.ownKeys(value).length === 0
    ) {
      const timestamp = Date.prototype.getTime.call(value);
      if (Number.isFinite(timestamp)) {
        const serialized = new Date(timestamp).toISOString();
        consumeText(serialized, budget, MAX_FRONTMATTER_TEXT_BYTES);
        return serialized;
      }
    }
    throw new TypeError(`Frontmatter ${path} must not contain an invalid date`);
  }
  if (budget.ancestors.has(value)) throw new TypeError("Frontmatter must not contain cycles");
  budget.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_FRONTMATTER_NODES - budget.nodes) {
        throw new TypeError("Frontmatter exceeds the node limit");
      }
      if (Reflect.ownKeys(value).length !== value.length + 1) {
        throw new TypeError("Frontmatter arrays must contain only indexed data properties");
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("Frontmatter values must use data properties");
        }
        result.push(
          cloneSerializableValue(descriptor.value, `${path}[${index}]`, depth + 1, budget),
        );
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Frontmatter ${path} must contain only plain objects`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_FRONTMATTER_NODES - budget.nodes) {
      throw new TypeError("Frontmatter exceeds the node limit");
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const ownKey of keys) {
      if (typeof ownKey !== "string") {
        throw new TypeError("Frontmatter keys must be strings");
      }
      const key = ownKey;
      consumeText(key, budget, MAX_FRONTMATTER_KEY_BYTES);
      if (
        !key || hasUnsafeControlCharacters(key) ||
        key === "__proto__" || key === "prototype" || key === "constructor"
      ) {
        throw new TypeError("Frontmatter contains an unsafe key");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Frontmatter values must use enumerable data properties");
      }
      result[key] = cloneSerializableValue(
        descriptor.value,
        `${path}.${key}`,
        depth + 1,
        budget,
      );
    }
    return result;
  } finally {
    budget.ancestors.delete(value);
  }
}

export function normalizeMDXFrontmatter(value: unknown): MDXFrontmatter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Frontmatter must be a plain object");
  }
  const record = cloneSerializableValue(value, "value", 0, {
    nodes: 0,
    textBytes: 0,
    ancestors: new WeakSet(),
  }) as Record<string, unknown>;
  if (record.title !== undefined && typeof record.title !== "string") {
    throw new TypeError("Frontmatter title must be a string");
  }
  if (record.description !== undefined && typeof record.description !== "string") {
    throw new TypeError("Frontmatter description must be a string");
  }
  if (record.layout !== undefined && typeof record.layout !== "boolean") {
    throw new TypeError("Frontmatter layout must be a boolean");
  }
  return JSON.parse(JSON.stringify(record)) as MDXFrontmatter;
}

/** Serialize metadata without object-literal `__proto__` semantics. */
export function createFrontmatterModuleExpression(value: unknown): string {
  const serialized = JSON.stringify(normalizeMDXFrontmatter(value));
  return `JSON.parse(${JSON.stringify(serialized)})`;
}
