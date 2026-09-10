type FixtureGlobals = typeof globalThis & {
  __vfNativeObservations?: string[];
  __vfNativeCalls?: number;
};
const globals = globalThis as FixtureGlobals;
const seen: string[] = globals.__vfNativeObservations ??= [];
const stringify = JSON.stringify;
const apply = Reflect.apply;
const test = RegExp.prototype.test;
const marker = /synthetic-trusted-private-[a-f0-9-]{36}/;

function observe(value: unknown) {
  let text: string | undefined;
  try {
    text = typeof value === "string" ? value : stringify(value);
  } catch {
    return;
  }
  if (text && apply(test, marker, [text])) seen.push("private marker observed");
}

export function installHooks() {
  const trim = String.prototype.trim;
  String.prototype.trim = function () {
    observe(this);
    return apply(trim, this, []);
  };
  const map = Array.prototype.map;
  Array.prototype.map = function (callback, thisArg) {
    observe(this);
    return apply(map, this, [callback, thisArg]);
  };
  const iterator = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function () {
    observe(this);
    return apply(iterator, this, []);
  };
  const set = Map.prototype.set;
  Map.prototype.set = function (key, value) {
    observe(value);
    return apply(set, this, [key, value]);
  };
  const then = Promise.prototype.then;
  Promise.prototype.then = function (this: Promise<unknown>, fulfilled, rejected) {
    return apply(then, this, [(value: unknown) => {
      observe(value);
      return typeof fulfilled === "function" ? fulfilled(value) : value;
    }, rejected]);
  } as typeof then;
}

export function observations(): string[] {
  return [...seen];
}
