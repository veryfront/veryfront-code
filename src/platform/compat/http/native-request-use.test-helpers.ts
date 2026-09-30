/**
 * Records which `Request`, `Headers` and header-iterator prototype members a
 * native call uses, so a test can pin them to what
 * `assertNativeRequestProcessing` checks. A Deno upgrade that makes `fetch`
 * or `new Request()` call another member with the headers in reach then fails
 * that test instead of silently reopening the leak.
 */

type WatchedPrototype =
  | typeof Request.prototype
  | typeof Headers.prototype
  | IterableIterator<[string, string]>;

const WATCHED: readonly [WatchedPrototype, string][] = [
  [Request.prototype, "Request"],
  [Headers.prototype, "Headers"],
  [Object.getPrototypeOf(new Headers().entries()), "HeadersIterator"],
];

function wrap(target: WatchedPrototype, label: string, used: Set<string>): (() => void)[] {
  const restores: (() => void)[] = [];
  for (const key of Reflect.ownKeys(target)) {
    if (key === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
    // Locked internals cannot be replaced, so they need no check.
    if (!descriptor.configurable) continue;
    const name = `${label}.${String(key)}`;
    if (descriptor.get) {
      const getter = descriptor.get;
      Object.defineProperty(target, key, {
        ...descriptor,
        get(this: unknown) {
          used.add(name);
          return Reflect.apply(getter, this, []);
        },
      });
    } else if (typeof descriptor.value === "function") {
      const method = descriptor.value as (...args: unknown[]) => unknown;
      Object.defineProperty(target, key, {
        ...descriptor,
        value: function (this: unknown, ...args: unknown[]) {
          used.add(name);
          return Reflect.apply(method, this, args);
        },
      });
    } else {
      continue;
    }
    restores.push(() => Object.defineProperty(target, key, descriptor));
  }
  return restores;
}

/** The prototype members `fn` used, as `Label.member`. */
export function recordNativePrototypeUse(fn: () => void): string[];
export function recordNativePrototypeUse(fn: () => Promise<void>): Promise<string[]>;
export function recordNativePrototypeUse(
  fn: () => void | Promise<void>,
): string[] | Promise<string[]> {
  const used = new Set<string>();
  const restores = WATCHED.flatMap(([target, label]) => wrap(target, label, used));
  const restore = () => {
    for (const undo of restores) undo();
  };
  let result: void | Promise<void>;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      () => {
        restore();
        return [...used].sort((a, b) => a.localeCompare(b));
      },
      (error) => {
        restore();
        throw error;
      },
    );
  }
  restore();
  return [...used].sort((a, b) => a.localeCompare(b));
}

/** True for a member `assertNativeRequestProcessing` refuses to see replaced. */
export function isCheckedNativeRequestProperty(name: string): boolean {
  return name === "Request.headers" || name === "Request.signal" ||
    (name.startsWith("Request.Symbol(") && name !== "Request.Symbol(Symbol.toStringTag)") ||
    (name.startsWith("Headers.Symbol(") && name !== "Headers.Symbol(Symbol.iterator)") ||
    name === "Headers.has" || name === "Headers.append";
}

/**
 * Replace the public `Request.prototype.signal` getter with a pass-through, as
 * project code could, until the returned function restores it.
 */
export function replaceRequestSignalGetter(): () => void {
  const original = Object.getOwnPropertyDescriptor(Request.prototype, "signal")!;
  Object.defineProperty(Request.prototype, "signal", {
    ...original,
    get(this: Request) {
      return Reflect.apply(original.get!, this, []);
    },
  });
  return () => Object.defineProperty(Request.prototype, "signal", original);
}
