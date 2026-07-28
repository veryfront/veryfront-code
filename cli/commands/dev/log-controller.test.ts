import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "veryfront/platform";
import { refreshLoggerConfig } from "veryfront/utils";
import { createDevLogController } from "./log-controller.ts";

describe("dev log controller", () => {
  let originalLogLevel: string | undefined;
  let originalDebug: string | undefined;

  beforeEach(() => {
    originalLogLevel = getEnv("LOG_LEVEL");
    originalDebug = getEnv("VERYFRONT_DEBUG");
    deleteEnv("VERYFRONT_DEBUG");
  });

  afterEach(() => {
    if (originalLogLevel === undefined) deleteEnv("LOG_LEVEL");
    else setEnv("LOG_LEVEL", originalLogLevel);

    if (originalDebug === undefined) deleteEnv("VERYFRONT_DEBUG");
    else setEnv("VERYFRONT_DEBUG", originalDebug);

    refreshLoggerConfig();
  });

  it("toggles verbose logs and restores the previous normal level", () => {
    setEnv("LOG_LEVEL", "WARN");
    const logs = createDevLogController();

    assertEquals(logs.isVerbose(), false);
    assertEquals(logs.toggle(), true);
    assertEquals(getEnv("LOG_LEVEL"), "DEBUG");
    assertEquals(logs.toggle(), false);
    assertEquals(getEnv("LOG_LEVEL"), "WARN");
  });

  it("can turn off an initially verbose dev session", () => {
    setEnv("LOG_LEVEL", "DEBUG");
    const logs = createDevLogController();

    assertEquals(logs.isVerbose(), true);
    assertEquals(logs.toggle(), false);
    assertEquals(getEnv("LOG_LEVEL"), "INFO");
  });
});
