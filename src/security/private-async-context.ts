import { AsyncLocalStorage } from "node:async_hooks";

const NativeAsyncLocalStorage = AsyncLocalStorage;
const defineProperty = Object.defineProperty;
const storageMethods: { key: PropertyKey; value: unknown }[] = [];
for (const key of Reflect.ownKeys(NativeAsyncLocalStorage.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(NativeAsyncLocalStorage.prototype, key);
  if (key !== "constructor" && typeof descriptor?.value === "function") {
    storageMethods.push({ key, value: descriptor.value });
  }
}

/** Keep native receiver methods private when project code changes ALS prototypes. */
export function createPrivateAsyncLocalStorage<T>(): AsyncLocalStorage<T> {
  const storage = new NativeAsyncLocalStorage<T>();
  for (let index = 0; index < storageMethods.length; index++) {
    const method = storageMethods[index]!;
    defineProperty(storage, method.key, { value: method.value });
  }
  return storage;
}
