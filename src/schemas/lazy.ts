/**
 * Lazy schema facade with contract validation and metadata forwarding.
 *
 * @module schemas/lazy
 */

import type {
  RefinementCtx,
  Schema,
  ValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import { assertSchemaContract } from "./define.ts";

function configurableDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  return { ...descriptor, configurable: true };
}

function copyOwnProperties(target: object, source: object): boolean {
  for (const prop of Reflect.ownKeys(source)) {
    if (Reflect.getOwnPropertyDescriptor(target, prop)) continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(source, prop);
    const targetDescriptor = descriptor && !("value" in descriptor)
      ? {
        ...descriptor,
        get: descriptor.get?.bind(source),
        set: descriptor.set?.bind(source),
      }
      : descriptor;
    if (
      targetDescriptor &&
      !Reflect.defineProperty(target, prop, configurableDescriptor(targetDescriptor))
    ) {
      return false;
    }
  }
  return true;
}

export function lazySchema<T>(getSchema: () => Schema<T>): Schema<T> {
  let cached: Schema<T> | undefined;
  let materializing = false;
  const schema = (): Schema<T> => {
    if (cached !== undefined) return cached;
    if (materializing) {
      throw new Error("lazySchema getter recursively invoked its own facade");
    }

    materializing = true;
    try {
      const concreteSchema = getSchema();
      assertSchemaContract<T>(
        concreteSchema,
        "lazySchema getter must return a Schema contract implementation",
      );
      cached = concreteSchema;
      return concreteSchema;
    } finally {
      materializing = false;
    }
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

  return new Proxy(facade, {
    get(target, prop, receiver) {
      if (Object.hasOwn(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      const concreteSchema = schema() as object;
      if (prop in concreteSchema) {
        return Reflect.get(concreteSchema, prop, concreteSchema);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return Object.hasOwn(target, prop) || prop in (schema() as object) || prop in target;
    },
    ownKeys(target) {
      if (!Reflect.isExtensible(target)) return Reflect.ownKeys(target);
      return Array.from(
        new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(schema() as object)]),
      );
    },
    getOwnPropertyDescriptor(target, prop) {
      const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, prop);
      if (targetDescriptor || !Reflect.isExtensible(target)) return targetDescriptor;
      const schemaDescriptor = Reflect.getOwnPropertyDescriptor(schema() as object, prop);
      return schemaDescriptor && configurableDescriptor(schemaDescriptor);
    },
    preventExtensions(target) {
      return copyOwnProperties(target, schema() as object) && Reflect.preventExtensions(target);
    },
  });
}
