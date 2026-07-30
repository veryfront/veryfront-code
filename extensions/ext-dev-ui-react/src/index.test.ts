import { assert, assertEquals, assertThrows } from "@std/assert";
import { type DevUiAssetProvider, DevUiAssetProviderName } from "veryfront/extensions";
import extensionPackage from "../deno.json" with { type: "json" };
import extDevUiReact from "./index.ts";

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createContext(provided: Map<string, unknown>, signal?: AbortSignal) {
  return {
    config: {},
    logger,
    signal,
    get: () => undefined,
    require: () => {
      throw new Error("No required contracts expected");
    },
    provide: (name: string, implementation: unknown) => {
      provided.set(name, implementation);
    },
  };
}

Deno.test("React Dev UI extension publishes one immutable offline bundle", () => {
  const extension = extDevUiReact();
  const provided = new Map<string, unknown>();

  extension.setup?.(createContext(provided));
  const provider = provided.get(DevUiAssetProviderName) as DevUiAssetProvider;
  assert(provider.browserBundle.length > 0);
  assertEquals(Object.isFrozen(provider), true);
  assertEquals(extension.version, extensionPackage.version);
  assertEquals(extension.contracts?.provides, [DevUiAssetProviderName]);
  assertEquals(extension.capabilities, []);
  assertThrows(() => extension.setup?.(createContext(new Map())), Error, "already set up");

  extension.teardown?.();
  extension.setup?.(createContext(new Map()));
  extension.teardown?.();
});

Deno.test("React Dev UI extension refuses a revoked setup context", () => {
  const extension = extDevUiReact();
  const controller = new AbortController();
  const reason = new DOMException("context retired", "AbortError");
  controller.abort(reason);

  assertThrows(
    () => extension.setup?.(createContext(new Map(), controller.signal)),
    DOMException,
    "context retired",
  );
});
