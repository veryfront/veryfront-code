import type { z } from "zod";

type Parser = z.ZodObject["_zod"]["parse"];
type Payload = Parameters<Parser>[0];
type ParseResult = ReturnType<Parser>;
type Context = Parameters<Parser>[1];
type Field = z.ZodObject["_zod"]["def"]["shape"][string];
type SchemaObjectData = Record<PropertyKey, unknown>;

const DATA_KEY = "__proto__";
const patched = new WeakSet<object>();
const HasOwn = Object.hasOwn;
const DefineProperty = Object.defineProperty;
const Get = Reflect.get;
const Apply = Reflect.apply;
const IsArray = Array.isArray;
const NativePromise = Promise;
const PromiseThen = Promise.prototype.then;

function isSchemaObjectData(value: unknown): value is SchemaObjectData {
  return value !== null && typeof value === "object" && !IsArray(value);
}

function continueParse(result: ParseResult, next: (value: Payload) => ParseResult): ParseResult {
  return result instanceof NativePromise
    ? Apply(PromiseThen, result, [next]) as Promise<Payload>
    : next(result);
}

function mergeDeclaredData(
  parent: Payload,
  child: Payload,
  field: Field,
  present: boolean,
  output: SchemaObjectData,
): Payload {
  for (let index = 0; index < child.issues.length; index++) {
    const issue = child.issues[index]!;
    parent.issues[parent.issues.length] = {
      ...issue,
      path: [DATA_KEY, ...(issue.path ?? [])],
    };
  }
  // Ordinary fields retain values for non-aborting refinements; their issues
  // still make validation fail. Defining data never calls the prototype setter.
  if (
    present || child.value !== undefined ||
    field._zod.optin === "defaulted" && field._zod.optout !== "optional"
  ) {
    const descriptor = {
      __proto__: null,
      configurable: true,
      enumerable: true,
      writable: true,
      value: child.value,
    };
    DefineProperty(output, DATA_KEY, descriptor);
  }
  return parent;
}

function parseDeclaredData(
  parent: Payload,
  input: SchemaObjectData,
  field: Field,
  context: Context,
): ParseResult {
  const output = parent.value;
  if (!isSchemaObjectData(output)) {
    throw new TypeError("Object schema parser returned an invalid output");
  }
  const present = HasOwn(input, DATA_KEY);
  const parsed = field._zod.run({
    value: present ? Get(input, DATA_KEY, input) : undefined,
    issues: [],
  }, context);
  return continueParse(parsed, (child) => mergeDeclaredData(parent, child, field, present, output));
}

/** Preserve declared data without restoring unsafe unknown-key assignment. */
export function preserveDeclaredObjectDataProperty(schema: z.ZodType): void {
  if (schema._zod.def.type !== "object" || patched.has(schema)) return;
  const object = schema as z.ZodObject;
  const shape = object._zod.def.shape;
  if (!HasOwn(shape, DATA_KEY)) return;
  const field = shape[DATA_KEY]!;
  let delegate = object._zod.parse;
  const directRun = object._zod.run === delegate;

  // Zod4.6 skips this name even in a declared shape. Validate it through its
  // actual field parser, then define an own data property before object checks.
  // No shared prototype or global parser changes; wrap() patches each clone.
  const parse: Parser = (payload, context) => {
    const input = payload.value;
    const issueCount = payload.issues.length;
    const result = delegate(payload, context);
    if (!isSchemaObjectData(input)) return result;
    return continueParse(result, (parent) => {
      if (parent.memo || context.abortEarly && parent.issues.length > issueCount) return parent;
      return parseDeclaredData(parent, input, field, context);
    });
  };
  // The memoizer replaces its parser from inside the first call. Keep this
  // instance's augmentation installed even during reentrant validation, while
  // allowing that replacement to become the delegate for subsequent calls.
  const descriptor = {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get: () => parse,
    set(next: Parser) {
      if (typeof next !== "function") throw new TypeError("Object schema parser is unavailable");
      if (next !== parse) delegate = next;
    },
  };
  DefineProperty(object._zod, "parse", descriptor);
  if (directRun) object._zod.run = parse;
  patched.add(schema);
}
