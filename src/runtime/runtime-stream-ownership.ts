import { AsyncLocalStorage } from "node:async_hooks";

type StreamOwner = { root: object; current: object };
const ownership = new AsyncLocalStorage<StreamOwner>();

/** Bind the outer runtime stream before asynchronous setup can start nested streams. */
export function withRuntimeStreamOwnership<T>(operation: () => T): T {
  const parent = ownership.getStore();
  const current = {};
  return ownership.run({ root: parent?.root ?? current, current }, operation);
}

/** A nested stream cannot claim the outer stream's managed result position. */
export function isPrimaryRuntimeStream(): boolean {
  const scope = ownership.getStore();
  return !scope || scope.current === scope.root;
}
