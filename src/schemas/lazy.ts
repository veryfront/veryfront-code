import type {
  RefinementCtx,
  Schema,
  ValidationResult,
} from "#veryfront/extensions/schema/index.ts";

function configurableDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  return { ...descriptor, configurable: true };
}

function copyOwnProperties(target: object, source: object): boolean {
  for (const prop of Reflect.ownKeys(source)) {
    if (Reflect.getOwnPropertyDescriptor(target, prop)) continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(source, prop);
    if (
      descriptor &&
      !Reflect.defineProperty(target, prop, configurableDescriptor(descriptor))
    ) {
      return false;
    }
  }
  return true;
}

export function lazySchema<T>(getSchema: () => Schema<T>): Schema<T> {
  let cached: Schema<T> | undefined;
  const schema = () => cached ??= getSchema();
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
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return Reflect.get(schema() as object, prop, receiver);
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
      if (targetDescriptor || !Reflect.isExtensible(target)) return targetDescriptor;
      const schemaDescriptor = Reflect.getOwnPropertyDescriptor(schema() as object, prop);
      return schemaDescriptor && configurableDescriptor(schemaDescriptor);
    },
    preventExtensions(target) {
      return copyOwnProperties(target, schema() as object) && Reflect.preventExtensions(target);
    },
  });
}
