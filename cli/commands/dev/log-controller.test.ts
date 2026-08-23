import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDevLogController, type DevLogControllerRuntime } from "./log-controller.ts";

describe("dev log controller", () => {
  it("toggles verbose logs and restores the previous normal level", () => {
    const runtime = createTestRuntime({ LOG_LEVEL: "WARN" });
    const logs = createDevLogController(runtime);

    assertEquals(logs.isVerbose(), false);
    assertEquals(logs.toggle(), true);
    assertEquals(runtime.getEnv("LOG_LEVEL"), "DEBUG");
    assertEquals(runtime.getEnv("VERYFRONT_DEBUG"), "1");
    assertEquals(logs.toggle(), false);
    assertEquals(runtime.getEnv("LOG_LEVEL"), "WARN");
    assertEquals(runtime.getEnv("VERYFRONT_DEBUG"), undefined);
  });

  it("can turn off an initially verbose dev session", () => {
    const runtime = createTestRuntime({ LOG_LEVEL: "DEBUG" });
    const logs = createDevLogController(runtime);

    assertEquals(logs.isVerbose(), true);
    assertEquals(logs.toggle(), false);
    assertEquals(runtime.getEnv("LOG_LEVEL"), "INFO");
    assertEquals(runtime.getEnv("VERYFRONT_DEBUG"), undefined);
  });

  it("uses the runtime truthy debug semantics and preserves a normal log level", () => {
    const runtime = createTestRuntime({
      LOG_LEVEL: "WARN",
      VERYFRONT_DEBUG: " Yes ",
    });
    const logs = createDevLogController(runtime);

    assertEquals(logs.isVerbose(), true);
    assertEquals(logs.toggle(), false);
    assertEquals(runtime.getEnv("LOG_LEVEL"), "WARN");
    assertEquals(runtime.getEnv("VERYFRONT_DEBUG"), undefined);
  });
});

function createTestRuntime(
  initialEnv: Readonly<Record<string, string>>,
): DevLogControllerRuntime {
  const environment = new Map(Object.entries(initialEnv));
  return {
    deleteEnv: (name) => {
      environment.delete(name);
    },
    getEnv: (name) => environment.get(name),
    refreshLoggerConfig: () => undefined,
    setEnv: (name, value) => {
      environment.set(name, value);
    },
  };
}
