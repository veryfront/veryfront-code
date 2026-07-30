import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type StudioCaptureBundleProvider,
  StudioCaptureBundleProviderName,
} from "veryfront/extensions";
import extStudioCaptureHtml2Canvas from "./index.ts";

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

Deno.test("html2canvas Studio extension explicitly publishes an immutable bundle", () => {
  const extension = extStudioCaptureHtml2Canvas();
  const provided = new Map<string, unknown>();

  extension.setup?.(createContext(provided));
  const contract = provided.get(
    StudioCaptureBundleProviderName,
  ) as StudioCaptureBundleProvider;
  assert(contract.browserBundle.length > 0);
  assert(Object.isFrozen(contract));
  assertEquals(extension.contracts?.provides, [StudioCaptureBundleProviderName]);
  assertEquals(extension.capabilities, []);
  assertThrows(() => extension.setup?.(createContext(new Map())), Error, "already set up");

  extension.teardown?.();
  extension.setup?.(createContext(new Map()));
  extension.teardown?.();
});

Deno.test("html2canvas Studio extension refuses a revoked setup context", () => {
  const extension = extStudioCaptureHtml2Canvas();
  const controller = new AbortController();
  const reason = new DOMException("context retired", "AbortError");
  controller.abort(reason);

  assertThrows(
    () => extension.setup?.(createContext(new Map(), controller.signal)),
    DOMException,
    "context retired",
  );
});
