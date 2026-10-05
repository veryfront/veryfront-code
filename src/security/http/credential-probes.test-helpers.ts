/**
 * Stand-ins for project code that shares the isolate and patches the
 * intrinsics a request pipeline uses, recording everything each patch can
 * reach. A test installs them, drives framework code, and asserts that no
 * recorded text contains a credential.
 */

export type HeaderMethod =
  | "append"
  | "entries"
  | "forEach"
  | "get"
  | "has"
  | "keys"
  | "set"
  | "values";

export const HEADER_METHODS: readonly HeaderMethod[] = [
  "append",
  "entries",
  "forEach",
  "get",
  "has",
  "keys",
  "set",
  "values",
];

/** The init fields Deno 2.7.7 reads by name, prototype chain included. */
export const PROBED_INIT_FIELDS = ["body", "client", "method", "redirect", "signal"] as const;

export interface CredentialProbes {
  /** Every value a patch saw, as text. */
  readonly observed: string[];
  /** How often each patch ran, so a test can prove it was reached. */
  readonly calls: Record<string, number>;
  /** True when any observation contains `secret`. */
  saw(secret: string): boolean;
  restore(): void;
}

export interface CredentialProbeOptions {
  /**
   * The `Headers.prototype` methods to replace, all of them by default. Native
   * `fetch` calls `has` and `append` with the headers as `this`, so the egress
   * stack refuses to send once those are replaced; leaving them out shows what
   * the remaining probes see on a request that is sent.
   */
  readonly headerMethods?: readonly HeaderMethod[];
}

export function installCredentialProbes(options: CredentialProbeOptions = {}): CredentialProbes {
  const headerMethods = options.headerMethods ?? HEADER_METHODS;
  const prototype = Headers.prototype;
  const iteratorPrototype = Object.getPrototypeOf(new Headers().entries()) as Record<
    string,
    unknown
  >;
  const originalMethods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  for (const name of [...headerMethods, Symbol.iterator]) {
    originalMethods.set(name, Reflect.get(prototype, name));
  }
  const originalEntries = prototype.entries;
  const originalNext = iteratorPrototype.next as (this: unknown) => IteratorResult<unknown>;
  const originalInitDescriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const field of PROBED_INIT_FIELDS) {
    originalInitDescriptors.set(field, Object.getOwnPropertyDescriptor(Object.prototype, field));
  }
  const originalObjectIterator = Object.getOwnPropertyDescriptor(Object.prototype, Symbol.iterator);
  const requestHeadersGetter = Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!;
  const collectionMethods = [
    [WeakMap.prototype, "WeakMap", ["delete", "get", "has", "set"]],
    [WeakSet.prototype, "WeakSet", ["add", "delete", "has"]],
  ] as const;
  const originalCollectionMethods: [object, string, unknown][] = [];
  for (const [target, , names] of collectionMethods) {
    for (const name of names) {
      originalCollectionMethods.push([target, name, Reflect.get(target, name)]);
    }
  }

  const observed: string[] = [];
  const calls: Record<string, number> = {};
  let recording = false;
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  // Reads through the saved originals, and never records its own reads.
  const dump = (value: unknown): string => {
    if (value instanceof Headers) {
      const parts: string[] = [];
      const iterator = originalEntries.call(value);
      while (true) {
        const step = originalNext.call(iterator) as IteratorResult<[string, string]>;
        if (step.done) break;
        parts.push(`${step.value[0]}: ${step.value[1]}`);
      }
      return parts.join("\n");
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const record = (name: string, value: unknown) => {
    if (recording) return;
    recording = true;
    try {
      count(name);
      observed.push(dump(value));
    } finally {
      recording = false;
    }
  };

  // For probes whose reach itself runs other probes.
  const recordLazy = (name: string, reach: () => unknown) => {
    if (recording) return;
    recording = true;
    let value: unknown;
    try {
      value = reach();
    } finally {
      recording = false;
    }
    record(name, value);
  };

  for (const [name, original] of originalMethods) {
    const label = typeof name === "symbol" ? "Symbol.iterator" : String(name);
    Reflect.set(prototype, name, function (this: Headers, ...args: unknown[]) {
      record(label, this);
      return original.apply(this, args);
    });
  }
  iteratorPrototype.next = function (this: unknown) {
    const step = originalNext.call(this);
    if (!step.done) record("next", step.value);
    return step;
  };
  for (const field of PROBED_INIT_FIELDS) {
    Object.defineProperty(Object.prototype, field, {
      configurable: true,
      get(this: unknown) {
        // A getter reached from a RequestInit has the init as `this`, and
        // with it the headers the init carries.
        if (typeof this === "object" && this !== null) {
          record(`Object.prototype.${field}`, (this as { headers?: unknown }).headers);
        }
        return undefined;
      },
    });
  }
  // Symbol-keyed members are reachable through Object.getOwnPropertySymbols,
  // and the native Request constructor calls some of them on the headers.
  const symbolRestores: (() => void)[] = [];
  for (const target of [Headers.prototype, Request.prototype]) {
    for (const key of Object.getOwnPropertySymbols(target)) {
      if (key === Symbol.iterator || key === Symbol.toStringTag) continue;
      const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
      // Locked by the framework, so project code cannot replace it either.
      if (!descriptor.configurable) continue;
      const label = `${target === Headers.prototype ? "Headers" : "Request"}.${String(key)}`;
      const reach = (self: unknown) =>
        self instanceof Request ? Reflect.apply(requestHeadersGetter, self, []) : self;
      if (descriptor.get) {
        const getter = descriptor.get;
        Object.defineProperty(target, key, {
          ...descriptor,
          get(this: unknown) {
            recordLazy(label, () => reach(this));
            return Reflect.apply(getter, this, []);
          },
        });
      } else if (typeof descriptor.value === "function") {
        const method = descriptor.value as (...args: unknown[]) => unknown;
        Object.defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            recordLazy(label, () => reach(this));
            return Reflect.apply(method, this, args);
          },
        });
      } else {
        continue;
      }
      symbolRestores.push(() => Object.defineProperty(target, key, descriptor));
    }
  }
  // A request used as a collection key reaches whoever replaced the method.
  for (const [target, label, names] of collectionMethods) {
    for (const name of names) {
      const original = Reflect.get(target, name) as (...args: unknown[]) => unknown;
      Reflect.set(target, name, function (this: unknown, ...args: unknown[]) {
        if (args[0] instanceof Request) {
          record(`${label}.${name}`, Reflect.apply(requestHeadersGetter, args[0], []));
        }
        return original.apply(this, args);
      });
    }
  }
  // A native header conversion asks a record for its iterator first, and an
  // ordinary record inherits the answer.
  Object.defineProperty(Object.prototype, Symbol.iterator, {
    configurable: true,
    get(this: unknown) {
      if (typeof this === "object" && this !== null) {
        record("Object.prototype[Symbol.iterator]", this);
      }
      return undefined;
    },
  });

  return {
    observed,
    calls,
    saw: (secret) => observed.some((text) => text.includes(secret)),
    restore() {
      for (const [name, original] of originalMethods) Reflect.set(prototype, name, original);
      iteratorPrototype.next = originalNext;
      for (const [field, descriptor] of originalInitDescriptors) {
        if (descriptor) Object.defineProperty(Object.prototype, field, descriptor);
        else delete (Object.prototype as Record<string, unknown>)[field];
      }
      for (const undo of symbolRestores) undo();
      for (const [target, name, original] of originalCollectionMethods) {
        Reflect.set(target, name, original);
      }
      if (originalObjectIterator) {
        Object.defineProperty(Object.prototype, Symbol.iterator, originalObjectIterator);
      } else {
        Reflect.deleteProperty(Object.prototype, Symbol.iterator);
      }
    },
  };
}

export interface GlobalFetchProbe {
  /** True when the replacement was handed `secret` in its URL or headers. */
  saw(secret: string): boolean;
  /** How many times the replacement was called. */
  readonly calls: () => number;
  restore(): void;
}

/**
 * Stand in for project code that replaced the global `fetch`: the replacement
 * records what it is handed and answers `fallback` (by default, forwards to the
 * fetch it replaced). Not a fetch stub: framework code must never reach it.
 */
export function installGlobalFetchProbe(
  fallback?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): GlobalFetchProbe {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const original = globalThis.fetch;
  const seen: string[] = [];
  let calls = 0;
  const replacement = (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    let headers = "";
    try {
      headers = JSON.stringify(init?.headers ?? null);
    } catch {
      // Unserializable headers are recorded by URL only.
    }
    seen.push(String(input), headers);
    return fallback ? fallback(input, init) : original(input, init);
  };
  Object.defineProperty(globalThis, "fetch", {
    value: replacement,
    configurable: true,
    writable: true,
  });
  return {
    saw: (secret) => seen.some((text) => text.includes(secret)),
    calls: () => calls,
    restore() {
      if (descriptor) Object.defineProperty(globalThis, "fetch", descriptor);
      else Reflect.deleteProperty(globalThis, "fetch");
    },
  };
}
