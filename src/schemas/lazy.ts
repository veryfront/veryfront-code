import type {
  RefinementCtx,
  Schema,
  ValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import { assertSchema } from "./schema-guard.ts";

const lazyResolvers = new WeakMap<object, () => Schema<unknown>>();

/**
 * Create a schema facade that resolves and memoizes its backing schema on
 * first use while preserving the backing implementation's method receiver.
 * Failed resolutions are not cached. Recursive lazy aliases throw a
 * deterministic `TypeError` instead of overflowing the call stack.
 */
export function lazySchema<T>(getSchema: () => Schema<T>): Schema<T> {
  if (typeof getSchema !== "function") {
    throw new TypeError("Schema getter must be a function");
  }
  let cached: Schema<T> | undefined;
  let resolving = false;
  const boundMethods = new Map<
    PropertyKey,
    { bound: CallableFunction; source: CallableFunction }
  >();
  const schema = (): Schema<T> => {
    if (cached !== undefined) return cached;
    if (resolving) throw new TypeError("Schema getter cannot resolve recursively");

    resolving = true;
    try {
      let candidate = getSchema();
      if (candidate === proxy) throw new TypeError("Schema getter cannot resolve recursively");
      const aliasResolver = lazyResolvers.get(candidate as object);
      if (aliasResolver) candidate = aliasResolver() as Schema<T>;
      assertSchema(candidate, "getter");
      cached = candidate;
      return candidate;
    } finally {
      resolving = false;
    }
  };
  const getForwardedValue = (prop: PropertyKey): unknown => {
    const resolved = schema() as object;
    const value = Reflect.get(resolved, prop, resolved);
    if (typeof value !== "function") return value;

    const existing = boundMethods.get(prop);
    if (existing && existing.source === value) return existing.bound;
    const bound = value.bind(resolved);
    boundMethods.set(prop, { bound, source: value });
    return bound;
  };
  const facade: Schema<T> = {
    _output: undefined as unknown as T,
    optional: () => schema().optional(),
    nullable: () => schema().nullable(),
    nullish: () => schema().nullish(),
    default: (value: Exclude<T, undefined> | (() => Exclude<T, undefined>)) =>
      schema().default(value),
    describe: (description: string) => schema().describe(description),
    refine: (check: (value: T) => boolean, message?: string | { message?: string }) =>
      schema().refine(check, message),
    superRefine: (check: (value: T, ctx: RefinementCtx) => void) => schema().superRefine(check),
    transform: <U>(fn: (value: T) => U) => schema().transform(fn),
    strict: () => schema().strict(),
    strip: () => schema().strip(),
    passthrough: () => schema().passthrough(),
    partial: () => schema().partial(),
    extend: <U extends Record<string, Schema<unknown>>>(shape: U) => schema().extend(shape),
    merge: <U>(other: Schema<U>) => schema().merge(other),
    omit: <K extends keyof T>(keys: { [P in K]?: true }) => schema().omit(keys),
    pick: <K extends keyof T>(keys: { [P in K]?: true }) => schema().pick(keys),
    min: (value: number, message?: string) => schema().min(value, message),
    max: (value: number, message?: string) => schema().max(value, message),
    int: (message?: string) => schema().int(message),
    positive: (message?: string) => schema().positive(message),
    nonnegative: (message?: string) => schema().nonnegative(message),
    regex: (pattern: RegExp, message?: string) => schema().regex(pattern, message),
    email: (message?: string) => schema().email(message),
    url: (message?: string) => schema().url(message),
    uuid: (message?: string) => schema().uuid(message),
    datetime: (message?: string) => schema().datetime(message),
    pipe: <U>(next: Schema<U>) => schema().pipe(next),
    parse: (data: unknown): T => schema().parse(data),
    safeParse: (data: unknown): ValidationResult<T> => schema().safeParse(data),
  };

  const proxy = new Proxy(facade, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return getForwardedValue(prop);
    },
    has(target, prop) {
      return prop in target || prop in (schema() as object);
    },
    ownKeys(target) {
      if (!Reflect.isExtensible(target)) return Reflect.ownKeys(target);
      return Array.from(
        new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(schema() as object)]),
      );
    },
    getOwnPropertyDescriptor(target, prop) {
      const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, prop);
      if (targetDescriptor) return targetDescriptor;
      if (!Reflect.isExtensible(target)) return undefined;
      const forwardedDescriptor = Reflect.getOwnPropertyDescriptor(schema() as object, prop);
      if (!forwardedDescriptor) return undefined;
      return {
        ...forwardedDescriptor,
        configurable: true,
        ...(Object.hasOwn(forwardedDescriptor, "value") ? { value: getForwardedValue(prop) } : {}),
      };
    },
  });
  lazyResolvers.set(proxy as object, schema as () => Schema<unknown>);
  return proxy;
}
