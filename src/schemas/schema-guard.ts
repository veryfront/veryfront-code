import type { Schema } from "#veryfront/extensions/schema/index.ts";

type SchemaMethodName = {
  [K in keyof Schema<unknown>]-?: Schema<unknown>[K] extends CallableFunction ? K : never;
}[keyof Schema<unknown>];

const REQUIRED_SCHEMA_METHODS = Object.freeze(
  {
    optional: true,
    nullable: true,
    nullish: true,
    default: true,
    describe: true,
    refine: true,
    superRefine: true,
    transform: true,
    strict: true,
    strip: true,
    passthrough: true,
    partial: true,
    extend: true,
    merge: true,
    omit: true,
    pick: true,
    min: true,
    max: true,
    int: true,
    positive: true,
    nonnegative: true,
    regex: true,
    email: true,
    url: true,
    uuid: true,
    datetime: true,
    pipe: true,
    parse: true,
    safeParse: true,
  } satisfies Record<SchemaMethodName, true>,
);

const REQUIRED_SCHEMA_METHOD_NAMES = Object.freeze(
  Object.keys(REQUIRED_SCHEMA_METHODS) as SchemaMethodName[],
);

/** Validate the runtime surface promised by the opaque schema contract. */
export function assertSchema(
  value: unknown,
  source: "argument" | "factory" | "getter",
): asserts value is Schema<unknown> {
  const invalidSchema = () =>
    new TypeError(
      source === "argument"
        ? "Schema argument must be a valid schema"
        : `Schema ${source} returned an invalid schema`,
    );
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw invalidSchema();
  }
  try {
    for (const method of REQUIRED_SCHEMA_METHOD_NAMES) {
      if (typeof Reflect.get(value, method) !== "function") throw invalidSchema();
    }
  } catch {
    throw invalidSchema();
  }
}
