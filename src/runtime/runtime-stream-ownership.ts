import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";

type StreamOwner = { root: object; current: object };
const ownership = createPrivateAsyncLocalStorage<StreamOwner>();

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

const controllerOwners = createPrivateWeakStore<
  ReadableStreamDefaultController,
  ReadableStreamDefaultController
>();

/** Bind a framework forwarding controller to the stream it actually enqueues into. */
export function bindRuntimeStreamForwardingController(
  forwarding: ReadableStreamDefaultController,
  owner: ReadableStreamDefaultController,
): void {
  const root = getRuntimeStreamControllerOwner(owner);
  const existing = controllerOwners.get(forwarding);
  if (existing && existing !== root) {
    throw new TypeError("Runtime forwarding controller already belongs to another stream");
  }
  controllerOwners.set(forwarding, root);
}

/** Resolve producer ownership without changing the controller's output behavior. */
export function getRuntimeStreamControllerOwner(
  controller: ReadableStreamDefaultController,
): ReadableStreamDefaultController {
  return controllerOwners.get(controller) ?? controller;
}
