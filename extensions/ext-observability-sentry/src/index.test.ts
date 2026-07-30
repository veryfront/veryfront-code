import { assertEquals, assertThrows } from "@std/assert";
import { ApplicationErrorReporterInitializerName } from "veryfront/extensions/observability";
import extSentry from "./index.ts";

Deno.test("extension publishes the generic application-error initializer contract", () => {
  const extension = extSentry({ readEnvironment: () => undefined });
  const provided = new Map<string, unknown>();
  extension.setup?.({
    get: () => undefined,
    require: () => {
      throw new Error("no contracts required");
    },
    provide: (name, value) => provided.set(name, value),
    config: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
  });

  assertEquals(extension.name, "ext-observability-sentry");
  assertEquals(extension.contracts?.provides, [ApplicationErrorReporterInitializerName]);
  assertEquals(
    typeof (provided.get(ApplicationErrorReporterInitializerName) as { initialize?: unknown })
      ?.initialize,
    "function",
  );
});

Deno.test("extension rejects invalid composition config", () => {
  assertThrows(
    () => extSentry([]),
    TypeError,
    "Sentry initializer options must be a plain object",
  );
  assertThrows(
    () => extSentry({ fallback: true }),
    TypeError,
    "unsupported property",
  );
});
