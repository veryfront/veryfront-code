import type { RuntimeAdapter, RuntimeModuleLoader, RuntimeModuleReference } from "./base.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const apply = Reflect.apply;
const freeze = Object.freeze;

/** Capture an explicit adapter capability, without accepting prototype-injected loaders. */
export function getRuntimeModuleLoader(adapter?: RuntimeAdapter): RuntimeModuleLoader | undefined {
  if (adapter === undefined) return undefined;
  if (isProxyWithoutHooks(adapter)) {
    throw new TypeError("Module loading requires a non-proxy adapter");
  }
  const descriptor = getOwnPropertyDescriptor(adapter, "moduleLoader");
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new TypeError("moduleLoader must be an own data property");
  const loader: unknown = descriptor.value;
  if (loader === undefined) return undefined;
  if (loader === null || typeof loader !== "object" || isProxyWithoutHooks(loader)) {
    throw new TypeError("moduleLoader must be a non-proxy object");
  }
  const method = getOwnPropertyDescriptor(loader, "importModule");
  if (!method || !("value" in method) || typeof method.value !== "function") {
    throw new TypeError("moduleLoader.importModule must be an own data-property function");
  }
  const importModule = method.value as RuntimeModuleLoader["importModule"];
  return freeze({
    importModule: (reference: RuntimeModuleReference) => apply(importModule, loader, [reference]),
  });
}
